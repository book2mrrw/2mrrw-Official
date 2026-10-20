import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { resolveProfileStatus } from '../profile-status.js';

const user = { id: 'member-1', name: 'Member' };
const resolve = (accountState = {}, circleSubmissions = []) => resolveProfileStatus({ currentUser: user, accountState, circleSubmissions });

test('complimentary collector without purchase-library items gets owner badge and Inner Circle access', () => {
  const result = resolve({ user, collectorCard: true, library: [], permissions: { collectorAccess: true, innerCircle: true } });
  assert.equal(result.userStatus.label, 'COLLECTOR CARD OWNER');
  assert.equal(result.collectorCardOwner, true);
  assert.equal(result.hasInnerCircleAccess, true);
});

test('canonical collector signals use the existing shared owner predicate', () => {
  for (const state of [
    { collectorCard: true },
    { permissions: { collectorAccess: true } },
    { permissions: { collector: true } },
    { collectorOwnerships: [{ entitlementStatus: 'active', verificationStatus: 'verified' }] },
  ]) assert.equal(resolve(state).userStatus.label, 'COLLECTOR CARD OWNER');
});

test('community participation does not replace the collector owner identity', () => {
  for (const count of [0, 1, 3]) {
    const result = resolve({ collectorCard: true }, Array.from({ length: count }, () => ({ by: user.name })));
    assert.equal(result.userStatus.label, 'COLLECTOR CARD OWNER');
    assert.equal(result.hasInnerCircleAccess, true);
  }
});

test('pending, paused and revoked ownerships do not display an owner badge', () => {
  for (const entitlementStatus of ['pending', 'paused', 'revoked']) {
    const result = resolve({ collectorCard: false, collectorOwnerships: [{ entitlementStatus, verificationStatus: 'verified' }] });
    assert.equal(result.collectorCardOwner, false);
    assert.equal(result.hasInnerCircleAccess, false);
    assert.equal(result.userStatus.label, 'EARLY SUPPORTER');
  }
});

test('a collector-looking product slug alone cannot confer identity or section access', () => {
  const result = resolve({ library: [{ slug: 'exc-card-not-an-entitlement' }], collectorCard: false });
  assert.equal(result.collectorCardOwner, false);
  assert.equal(result.hasInnerCircleAccess, false);
});

test('subscribers and administrators retain section access without becoming collector owners', () => {
  for (const account of [{ permissions: { innerCircle: true } }, { subscriberActive: true }, { permissions: { admin: true } }]) {
    const result = resolve(account);
    assert.equal(result.hasInnerCircleAccess, true);
    assert.equal(result.collectorCardOwner, false);
    assert.equal(result.userStatus.label, 'EARLY SUPPORTER');
  }
});

test('ordinary community badges and byline counting are preserved without unlocking Inner Circle', () => {
  const result = resolveProfileStatus({ currentUser: user, accountCircleByline: 'account-byline', circleSubmissions: [{ by: 'account-byline' }, { by: user.name }, { by: user.name }, { by: 'someone-else' }] });
  assert.equal(result.userStatus.label, 'VISIONARY');
  assert.equal(result.hasInnerCircleAccess, false);
  assert.equal(resolve({}, [{ by: user.name }]).userStatus.label, 'EARLY SUPPORTER');
});

test('signed-out and switched-account snapshots cannot retain another user collector identity', () => {
  const stale = { user: { id: 'previous-member' }, collectorCard: true, permissions: { innerCircle: true } };
  assert.equal(resolve(stale).collectorCardOwner, false);
  assert.equal(resolve(stale).hasInnerCircleAccess, false);
  const signedOut = resolveProfileStatus({ currentUser: null, accountState: stale });
  assert.equal(signedOut.userStatus, null);
  assert.equal(signedOut.hasInnerCircleAccess, false);
});

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const regionsSource = readFileSync(new URL('../../../components/storefront/PageAuthRegions.js', import.meta.url), 'utf8');
const compiled = transformSync(regionsSource, { filename: 'PageAuthRegions.js', jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code;
function regionHarness() {
  let auth;
  const componentModule = { exports: {} };
  runInNewContext(compiled, {
    module: componentModule, exports: componentModule.exports,
    require: id => {
      if (id === 'react') return { useMemo: factory => factory(), useEffect() {} };
      if (id === 'framer-motion') return { motion: { div: 'div' } };
      if (id === '@/context/AuthContext') return { useAuth: () => auth };
      if (id === '@/lib/auth/profile-status') return { resolveProfileStatus };
      if (id === '@/lib/deep-links') return {};
      if (id === '@/components/support/HelpSupportSection') return { default: () => null };
      return require(id);
    },
  });
  return { regions: componentModule.exports, setAuth: value => { auth = value; } };
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return text(node.props?.children);
}

test('sidebar, mobile header, and account/community bridge show the same badge after grant and clear it after revocation', () => {
  const h = regionHarness();
  for (const collectorCard of [false, true, false]) {
    h.setAuth({ currentUser: user, library: [], accountState: { user, collectorCard, permissions: { innerCircle: collectorCard } } });
    const props = { circleSubmissions: [], accountCircleByline: 'member-byline' };
    const expected = collectorCard ? 'COLLECTOR CARD OWNER' : 'EARLY SUPPORTER';
    assert.equal(text(h.regions.PageAuthSidebarBadge(props)), expected);
    assert.ok(text(h.regions.PageAuthMobileNavBadge(props)).includes(expected));
    const bridge = h.regions.PageAuthSessionBridge({ ...props, children: value => value });
    assert.equal(bridge.userStatus.label, expected);
    assert.equal(bridge.hasInnerCircleAccess, collectorCard);
    assert.equal(bridge.collectorCardOwner, collectorCard);
  }
  h.setAuth({ currentUser: null, accountState: { collectorCard: true }, library: [] });
  assert.equal(h.regions.PageAuthSidebarBadge({}), null);
  assert.equal(h.regions.PageAuthMobileNavBadge({}), null);
});

test('Inner Circle display uses the resolved permission rather than matching badge copy', () => {
  const home = readFileSync(new URL('../../../app/HomeClient.js', import.meta.url), 'utf8');
  assert.match(home, /!pa\.hasInnerCircleAccess/);
  assert.doesNotMatch(home, /pa\.userStatus\?\.label\s*!==\s*"INNER CIRCLE"/);
  assert.match(home, /done:pa\.collectorCardOwner/);
});
