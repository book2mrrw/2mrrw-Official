import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

// Media Authority Refactor, Change 1: FullVideoAuthority is additive — Vault
// and Full Visual Experience keep their existing VRM registrations completely
// unchanged, and gain a new, separate full-video-session-exclusivity
// registration alongside it. Losing FullVideoAuthority only pauses the
// element, never unmounts/destroys it.

test("VaultVideoPlayer.js keeps its existing VRM.PRIORITY_SYSTEM registration untouched", () => {
  const src = read("src/components/vault/VaultVideoPlayer.js");
  assert.match(src, /VRM\.register\(el, VRM\.PRIORITY_SYSTEM\);/);
  assert.match(src, /VRM\.requestPause\(el\);\s*\n\s*VRM\.unregister\(el\);/);
});

test("VaultVideoPlayer.js additionally requests FullVideoAuthority and releases it on cleanup", () => {
  const src = read("src/components/vault/VaultVideoPlayer.js");
  assert.match(src, /import \{ FullVideoAuthority \} from "@\/lib\/media\/full-video-authority";/);
  const fnAt = src.indexOf('const sessionId = `vault:');
  assert.ok(fnAt > -1);
  const body = src.slice(fnAt, fnAt + 400);
  assert.match(body, /FullVideoAuthority\.requestFullVideoSession\(sessionId, \{/);
  assert.match(body, /if \(el && !el\.paused\) el\.pause\(\);/);
  assert.match(body, /return \(\) => FullVideoAuthority\.releaseFullVideoSession\(sessionId\);/);
});

test("FullVisualExperience.js keeps its existing VRM.PRIORITY_SYSTEM registration untouched", () => {
  const src = read("src/components/music/FullVisualExperience.js");
  assert.match(src, /VRM\.register\(el, VRM\.PRIORITY_SYSTEM\);/);
  assert.match(src, /return \(\) => \{ VRM\.unregister\(el\); \};/);
});

test("FullVisualExperience.js additionally requests FullVideoAuthority and releases it on cleanup", () => {
  const src = read("src/components/music/FullVisualExperience.js");
  assert.match(src, /import \{ FullVideoAuthority \} from "@\/lib\/media\/full-video-authority";/);
  const fnAt = src.indexOf('const sessionId = `full-visual:');
  assert.ok(fnAt > -1);
  const body = src.slice(fnAt, fnAt + 400);
  assert.match(body, /FullVideoAuthority\.requestFullVideoSession\(sessionId, \{/);
  assert.match(body, /if \(el && !el\.paused\) el\.pause\(\);/);
  assert.match(body, /return \(\) => FullVideoAuthority\.releaseFullVideoSession\(sessionId\);/);
});

test("FullVideoAuthority's yield callback is pause-only in both consumers — never src removal, load(), or unmount", () => {
  for (const file of ["src/components/vault/VaultVideoPlayer.js", "src/components/music/FullVisualExperience.js"]) {
    const src = read(file);
    const onRevokedAt = src.indexOf("onRevoked: () => {");
    assert.ok(onRevokedAt > -1, `${file} must define an onRevoked callback`);
    const body = src.slice(onRevokedAt, onRevokedAt + 150);
    assert.doesNotMatch(body, /removeAttribute\("src"\)|\.load\(\)/);
  }
});
