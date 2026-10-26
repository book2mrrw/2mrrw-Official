import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveContentAccess } from '../../music-access.js';
import { commitStorefrontCardChrome, getStorefrontCardChrome, subscribeStorefrontCardChrome } from '../storefront-card-chrome-store.js';

const item = { slug: 'example', price: 1.29 };
test('initial card snapshot suppresses unresolved purchase chrome', () => {
  const access = resolveContentAccess(item, getStorefrontCardChrome().entitlementAccountState);
  assert.equal(access.showPrice, false);
  assert.equal(access.showCart, false);
});
test('resolution to guest publishes even when entitlement values are identical', () => {
  const pending = getStorefrontCardChrome().entitlementAccountState;
  let updates = 0;
  const unsubscribe = subscribeStorefrontCardChrome(() => updates++);
  commitStorefrontCardChrome({ entitlementAccountState: { ...pending, commerceReady: true } });
  assert.equal(updates, 1);
  const access = resolveContentAccess(item, getStorefrontCardChrome().entitlementAccountState);
  assert.equal(access.showPrice, true);
  assert.equal(access.showCart, true);
  unsubscribe();
});
test('sign-in hides purchase chrome until the new account resolves', () => {
  for (const state of [{}, { ownedSlugs: ['example'] }, { permissions: { admin: true } }, { subscriberActive: true }, { collectorCard: true }]) {
    const pending = resolveContentAccess(item, { ...state, commerceReady: false });
    assert.equal(pending.showPrice, false);
    assert.equal(pending.showCart, false);
    const ready = resolveContentAccess(item, { ...state, commerceReady: true });
    assert.equal(ready.showPrice, Object.keys(state).length === 0);
    assert.equal(ready.showCart, ready.showPrice);
    // Presentation readiness never grants or revokes playback permission.
    assert.equal(pending.canStream, ready.canStream);
  }
});
test('sign-out and unowned content retain purchase options after resolution', () => {
  const owner = { ownedSlugs: ['different'], commerceReady: true };
  assert.equal(resolveContentAccess(item, owner).showPrice, true);
  assert.equal(resolveContentAccess(item, { commerceReady: true }).showCart, true);
});
