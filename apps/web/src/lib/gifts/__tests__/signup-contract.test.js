import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { register, createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { validateEmail } from '../../auth/validation.js';

register('data:text/javascript,' + encodeURIComponent('export function resolve(s,c,n){return n(s === "next/server" ? "next/server.js" : s,c);}'), import.meta.url);
mock.module('next/server', { namedExports: { NextResponse: Response } });
let gift, allowed = true, lookups = 0;
mock.module('@/lib/gifts/helpers', { namedExports: {
  getGiftByToken: async () => { lookups++; return gift; },
  expireGiftIfNeeded: async g => g,
  giftPublicState: g => ({ state: g.status === 'pending' ? 'valid' : g.status }),
  resolveProductForGift: async () => null,
  claimGiftForUser: async () => { throw new Error("must not claim rejected signup"); },
} });
mock.module('@/lib/server/rate-limit', { namedExports: {
  checkRateLimit: async () => ({ allowed }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
} });
mock.module('@/lib/gifts/token-hash', { namedExports: { hashGiftLinkToken: t => t } });
mock.module('@/lib/media-urls', { namedExports: { catalogCoverUrl: u => u } });
mock.module('@/lib/media/canonical-catalog', { namedExports: { getCanonicalReleaseBySlug: () => null } });
const { GET } = await import('../../../app/api/gifts/preview/[token]/route.js');
const preview = () => GET(new Request('https://example.test/api/gifts/preview/token'), { params: Promise.resolve({ token: 'token' }) });
const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const source = readFileSync(new URL('../../../app/gift/[token]/page.js', import.meta.url), 'utf8');
const compiled = transformSync(source, { filename: 'gift-page.js', jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code;

// Execute the real component and submit handler with simulated hooks/network.
// This verifies UI payloads without claiming browser or Supabase coverage.
function formHarness(data) {
  const values = [data, false];
  let slot = 0;
  const requests = [];
  const hooks = {
    useState(initial) { const i = slot++; if (!(i in values)) values[i] = initial; return [values[i], v => { values[i] = v; }]; },
    useEffect() {}, useCallback: f => f, useRef: v => ({ current: v }),
  };
  const componentModule = { exports: {} };
  runInNewContext(compiled, {
    module: componentModule, exports: componentModule.exports,
    require: id => {
      if (id === 'react') return hooks;
      if (id === 'next/link') return { default: 'a' };
      if (id === 'next/navigation') return { useParams: () => ({ token: 'token' }), useRouter: () => ({ push() {} }) };
      if (id === '@/context/AuthContext') return { useAuth: () => ({ user: null, loading: false, applySessionUser: async () => {} }) };
      if (id === '@/components/gifts/GiftRevealExperience') return { default: () => null };
      if (id === '@/lib/gifts/session-keys') return { hasSeenGiftReveal: () => false };
      if (id === '@/lib/auth/validation') return { validateEmail };
      if (id === '@/lib/auth/countries') return require('../../auth/countries.js');
      return require(id);
    },
    fetch: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return { ok: false, json: async () => ({ error: 'simulated response' }) }; },
  });
  function render() { slot = 0; return componentModule.exports.default(); }
  function nodes(node, type, result = []) {
    if (!node || typeof node !== 'object') return result;
    if (Array.isArray(node)) { node.forEach(n => nodes(n, type, result)); return result; }
    if (node.type === type) result.push(node);
    nodes(node.props?.children, type, result);
    return result;
  }
  function fill() {
    let tree = render();
    const inputs = nodes(tree, 'input');
    inputs.find(n => n.props.type === 'password').props.onChange({ target: { value: 'test-password-123' } });
    const location = inputs.filter(n => n.props.type === 'text');
    location[0].props.onChange({ target: { value: 'Dallas' } });
    location[1].props.onChange({ target: { value: 'tx' } });
    const buttons = nodes(tree, 'button');
    buttons.find(n => n.props.children === 'male').props.onClick();
    buttons.find(n => n.props.children === '25-40').props.onClick();
  }
  return { render, nodes, fill, requests, submit: async () => nodes(render(), 'form')[0].props.onSubmit({ preventDefault() {} }) };
}

test('email gift preview feeds a valid US signup payload without disclosing token fields', async () => {
  allowed = true;
  gift = { id: 'gift-1', status: 'pending', recipient_email: 'friend@example.com', gift_link_token: 'secret', sender_id: 'private' };
  const data = await (await preview()).json();
  assert.equal(data.gift.recipient_email, gift.recipient_email);
  assert.equal(data.gift.gift_link_token, undefined);
  assert.equal(data.gift.sender_id, undefined);
  const h = formHarness(data); h.fill();
  const email = h.nodes(h.render(), 'input').find(n => n.props.type === 'email');
  assert.equal(email.props.readOnly, true);
  assert.equal(email.props.value, gift.recipient_email);
  await h.submit();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].body.email, gift.recipient_email);
  assert.equal(h.requests[0].body.country, 'United States');
  assert.equal(h.requests[0].body.state, 'TX');
  assert.equal(h.requests[0].body.giftToken, 'token');
});

test('phone-only recipient can enter email; international signup drops stale US state', async () => {
  gift = { id: 'gift-2', status: 'pending', recipient_email: null };
  const h = formHarness(await (await preview()).json()); h.fill();
  const email = h.nodes(h.render(), 'input').find(n => n.props.type === 'email');
  assert.equal(email.props.readOnly, false);
  await h.submit(); assert.equal(h.requests.length, 0);
  email.props.onChange({ target: { value: ' Recipient@Example.com ' } });
  h.nodes(h.render(), 'select')[0].props.onChange({ target: { value: 'Canada' } });
  assert.equal(h.nodes(h.render(), 'input').filter(n => n.props.type === 'text').length, 1);
  await h.submit();
  assert.equal(h.requests[0].body.email, 'recipient@example.com');
  assert.equal(h.requests[0].body.country, 'Canada');
  assert.equal(h.requests[0].body.state, null);
});

test('US signup requires a state and missing country prevents submission', async () => {
  const h = formHarness({ state: 'valid', gift: { id: 'gift', recipient_email: 'friend@example.com' } }); h.fill();
  h.nodes(h.render(), 'input').filter(n => n.props.type === 'text')[1].props.onChange({ target: { value: '' } });
  await h.submit(); assert.equal(h.requests.length, 0);
  h.nodes(h.render(), 'select')[0].props.onChange({ target: { value: '' } });
  await h.submit(); assert.equal(h.requests.length, 0);
});

test('unknown and rate-limited gift previews remain denied', async () => {
  gift = null; assert.equal((await preview()).status, 404);
  allowed = false; const before = lookups;
  assert.equal((await preview()).status, 429); assert.equal(lookups, before);
  allowed = true;
});

let accountCreations = 0;
mock.module('@/lib/supabase/admin', { namedExports: { getAdminClient: () => {
  accountCreations++; throw new Error('must not create an account for rejected signup');
} } });
mock.module('@/lib/supabase/server', { namedExports: { createClient: async () => ({}) } });
mock.module('@/lib/auth/provision-new-user', { namedExports: { persistNewUserProfileOrRollback: async () => ({ ok: true }) } });
mock.module('@/lib/server/email', { namedExports: { buildWelcomeEmail: () => ({}), sendTransactionalEmail: async () => {} } });
mock.module('@/lib/geo/geocode-profile', { namedExports: { geocodeProfileIfNeeded: async () => {} } });
mock.module('@/lib/auth/attribution-cookie', { namedExports: { readAttributionCookie: async () => null } });
const { POST } = await import('../../../app/api/gifts/claim-signup/route.js');
const signup = overrides => POST(new Request('https://example.test/api/gifts/claim-signup', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'friend@example.com', password: 'test-password-123', country: 'United States', state: 'TX', giftToken: 'token', ...overrides }),
}));

test('claim signup still rejects email mismatch, inactive gifts, missing country and missing US state before creating an account', async () => {
  allowed = true;
  gift = { id: 'gift', status: 'pending', recipient_email: 'owner@example.com' };
  let response = await signup({});
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'email_mismatch');
  for (const status of ['expired', 'revoked', 'claimed']) {
    gift.status = status;
    assert.equal((await signup({ email: 'owner@example.com' })).status, 410);
  }
  gift.status = 'pending';
  for (const overrides of [{ country: '' }, { state: '' }, { email: '' }]) {
    assert.equal((await signup(overrides)).status, 400);
  }
  assert.equal(accountCreations, 0);
});
