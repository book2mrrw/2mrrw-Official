'use client';
import { useRef, useState } from 'react';
export default function OwnershipRecoveryForm({ giftToken = null, onComplete }) {
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  const purpose = giftToken ? 'claim_gift' : 'recover_library';
  async function submit(event) {
    event.preventDefault();
    if (flight.current) return;
    flight.current = true; setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/account/ownership', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(challenge ? { action: 'verify', purpose, challengeId: challenge, code } : { action: 'start', purpose, giftToken }) });
      const result = await response.json();
      if (!response.ok) {
        if (['challenge_unavailable','ownership_targets_changed','invalid_challenge'].includes(result.error)) { setChallenge(null); setCode(''); }
        throw new Error(result.error || 'verification_unavailable');
      }
      if (result.state === 'code_sent') { setChallenge(result.challengeId); setMessage('Enter the eight-digit code sent to your account email. It expires in five minutes.'); }
      else if (result.state === 'nothing_to_recover') setMessage('No eligible guest purchases need recovery for this account email. Ambiguous or expired rights need support review.');
      else { setChallenge(null); setCode(''); setMessage('Ownership verified. Your library has been updated.'); await onComplete?.(); }
    } catch (error) { setMessage(error.message.replaceAll('_',' ')); }
    finally { flight.current = false; setBusy(false); }
  }
  async function cancel() {
    if (flight.current) return;
    flight.current = true; setBusy(true);
    try {
      const response = await fetch('/api/account/ownership', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', purpose, challengeId: challenge }) });
      if (!response.ok) throw new Error('Cancellation could not be confirmed. The code expires in five minutes.');
      setChallenge(null); setCode(''); setMessage('Verification cancelled. No ownership was changed.');
    } catch (error) { setMessage(error.message); }
    finally { flight.current = false; setBusy(false); }
  }
  return <form onSubmit={submit} style={{ padding: 16, border: '1px solid #555', borderRadius: 12 }}>
    <p>{giftToken ? 'Verify your account email to claim this gift.' : 'Recover guest purchases made with your account email.'} Sign-in or SMS verification alone does not authorize recovery.</p>
    {challenge && <label>Email verification code <input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} value={code} onChange={e => setCode(e.target.value)} /></label>}
    <button type="submit" disabled={busy}>{busy ? 'Please wait…' : challenge ? 'Verify and recover' : 'Send email code'}</button>
    {challenge && <button type="button" disabled={busy} onClick={cancel}>Cancel</button>}
    <p role="status" aria-live="polite">{message}</p>
  </form>;
}
