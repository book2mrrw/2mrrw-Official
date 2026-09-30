import test from 'node:test';
import assert from 'node:assert/strict';
import { signVisualToken,verifyVisualToken } from '../token.js';
const id='12345678-1234-4234-8234-123456789012';
test('visual capability is version-bound, tamper-resistant, expiring and rotation-safe',()=>{
 process.env.HLS_HMAC_SECRET='a'.repeat(32);delete process.env.HLS_HMAC_SECRET_PREVIOUS;
 const token=signVisualToken(id,1000000);
 assert.ok(verifyVisualToken(token,id,1000000));
 assert.equal(verifyVisualToken(token,'22345678-1234-4234-8234-123456789012',1000000),false);
 assert.equal(verifyVisualToken(token+'x',id,1000000),false);
 assert.equal(verifyVisualToken(token,id,1000000+28800000),false);
 process.env.HLS_HMAC_SECRET_PREVIOUS=process.env.HLS_HMAC_SECRET;process.env.HLS_HMAC_SECRET='b'.repeat(32);
 assert.ok(verifyVisualToken(token,id,1000000));
 delete process.env.HLS_HMAC_SECRET_PREVIOUS;assert.equal(verifyVisualToken(token,id,1000000),false);
});
