import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("live chat is a separate table from community_comments, not a reuse that would skip the paywall gate", () => {
  const migrationDir = path.join(root, "supabase", "migrations");
  const files = fs.readdirSync(migrationDir).filter((f) => f.includes("live_chat_messages"));
  assert.equal(files.length, 1, "expected exactly one live_chat_messages migration");
  const sql = fs.readFileSync(path.join(migrationDir, files[0]), "utf8");
  assert.match(sql, /create table if not exists public\.live_chat_messages/);
  // No public RLS policy — reads and writes must go through the API routes,
  // which is where resolveLiveBroadcastAccess is actually enforced.
  assert.doesNotMatch(sql, /create policy/);
});

test("sending a chat message requires actual live access, checked the same way the paywall checks it", () => {
  const src = read("src/app/api/live/chat/send/route.js");
  assert.match(src, /resolveLiveBroadcastAccess\(/);
  const accessCheckAt = src.indexOf("resolveLiveBroadcastAccess(");
  const insertAt = src.indexOf(".insert(");
  assert.ok(accessCheckAt > -1 && insertAt > accessCheckAt,
    "access must be resolved before a message is ever inserted");
  assert.match(src, /access\.access !== "free"/);
});

test("chat history is also gated by live access, not freely readable", () => {
  const src = read("src/app/api/live/chat/history/route.js");
  assert.match(src, /resolveLiveBroadcastAccess\(/);
  assert.match(src, /access\.access !== "free"/);
});

test("guests (no real account) cannot send chat messages", () => {
  const src = read("src/app/api/live/chat/send/route.js");
  const guestCheckAt = src.indexOf("user.isGuest");
  const rateLimitAt = src.indexOf("checkRateLimit(");
  assert.ok(guestCheckAt > -1 && guestCheckAt < rateLimitAt,
    "the no-account check must be the first gate, before rate limiting or access checks");
});

test("chat messages are pushed over Realtime Broadcast, never via a direct client subscription to the table", () => {
  const sendSrc = read("src/app/api/live/chat/send/route.js");
  assert.match(sendSrc, /\.channel\(liveChatChannelName\(broadcast\.id\)\)\.send\(/);
  assert.match(sendSrc, /type:\s*"broadcast"/);

  const hookSrc = read("src/hooks/useLiveChat.js");
  assert.match(hookSrc, /channel\.on\(\s*"broadcast"/);
  assert.doesNotMatch(hookSrc, /postgres_changes/,
    "the client must never subscribe to Postgres changes directly on live_chat_messages");
});

test("client and server agree on the exact same channel name via one shared helper", () => {
  const channelSrc = read("src/lib/live/chat-channel.js");
  assert.match(channelSrc, /export function liveChatChannelName/);
  const sendSrc = read("src/app/api/live/chat/send/route.js");
  const hookSrc = read("src/hooks/useLiveChat.js");
  assert.match(sendSrc, /import\s*\{\s*liveChatChannelName\s*\}\s*from\s*"@\/lib\/live\/chat-channel"/);
  assert.match(hookSrc, /import\s*\{\s*liveChatChannelName\s*\}\s*from\s*"@\/lib\/live\/chat-channel"/);
});

test("the chat panel only renders for viewers who can actually watch the live", () => {
  const src = read("src/components/home/LiveCountdownDisplays.js");
  assert.match(src, /canViewLive && liveIsLive && liveBroadcastId && \(\s*<LiveChatPanel broadcastId=\{liveBroadcastId\} \/>/);
});
