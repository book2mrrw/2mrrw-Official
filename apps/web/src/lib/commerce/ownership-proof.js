const authorities = new WeakMap();
export class OwnershipVerificationRequired extends Error {
  constructor(code = 'email_verification_required', status = 409) {
    super(code); this.code = code; this.status = status;
  }
}
// Only server code can create this transaction-local capability; JSON is never proof.
export async function withOwnershipProof(binding, run) {
  const authority = Object.freeze({});
  authorities.set(authority, { ...binding, targets: new Set(binding.targets) });
  try { return await run(authority); } finally { authorities.delete(authority); }
}
export function requireOwnershipProof(authority, { userId, target, purpose }) {
  const proof = authority && authorities.get(authority);
  if (!proof || proof.userId !== userId || (purpose && proof.purpose !== purpose) || proof.expiresAt <= Date.now() || !proof.targets.has(target)) {
    throw new OwnershipVerificationRequired();
  }
  return proof;
}
