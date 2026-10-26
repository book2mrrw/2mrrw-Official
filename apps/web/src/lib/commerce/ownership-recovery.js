import crypto from 'node:crypto';
import { withOwnershipProof, OwnershipVerificationRequired } from '@/lib/commerce/ownership-proof';
import { transactionAdmin } from '@/lib/commerce/ownership-transaction';
import { grantLibraryItems } from '@/lib/commerce/entitlements';
import { invalidateAccountStateCache } from '@/lib/server/account-state-cache';
import { claimGiftForUser, resolveProductForGift } from '@/lib/gifts/helpers';
const normalize = value => String(value || '').trim().toLowerCase();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const digestCode = (handle, id, purpose, code) => crypto.createHmac('sha256', handle).update(`${id}:${purpose}:${code}`).digest('hex');
const deny = (code, status = 409) => { throw new OwnershipVerificationRequired(code, status); };
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// Dependencies are server-owned. Tests provide an isolated PostgreSQL transaction and email double.
export function createOwnershipRecovery({ transaction, sendEmail, now = Date.now }) {
  async function identity(tx, actor) {
    if (!actor?.id || !actor.email || normalize(actor.email).endsWith('@guest.2mrrw.local')) deny('registered_session_required', 401);
    const { rows } = await tx.query('select id, email from auth.users where id=$1 for share', [actor.id]);
    const email = normalize(rows[0]?.email);
    if (!email || email !== normalize(actor.email)) deny('identity_changed', 403);
    return email;
  }
  async function targetsFor(tx, actor, email, purpose, gift) {
    if (purpose === 'claim_gift') {
      if (!gift?.id) deny('gift_required', 400);
      const { rows } = await tx.query('select * from public.gifts where id=$1 for update', [gift.id]);
      const row = rows[0];
      if (!row || normalize(row.recipient_email) !== email) deny('email_mismatch', 403);
      if (row.status === 'revoked' || row.status === 'expired' || (row.status !== 'claimed' && row.expires_at && new Date(row.expires_at).getTime() <= now())) deny('gift_unavailable', 410);
      const product = await resolveProductForGift(row, transactionAdmin(tx));
      if (!product?.id || !product.slug) deny('gift_product_unavailable', 503);
      return [{ kind: 'gift', id: row.id, productId: product.id, slug: product.slug, itemId: row.item_id,
        recipient: email, sender: row.sender_id, status: row.status, recipientId: row.recipient_id, itemType: row.item_type, productType: product.product_type, contentType: product.content_type || null }];
    }
    if (purpose !== 'recover_library') deny('invalid_purpose', 400);
    // Profile matches select candidates only. Real Auth guest identity and completed
    // purchase provenance are mandatory. Mutable user_metadata.guest is never authority.
    const { rows } = await tx.query(`select li.id, li.user_id, li.product_id, li.purchase_id, p.slug
      from public.library_items li join public.profiles pr on pr.id=li.user_id
      join auth.users u on u.id=li.user_id join public.products p on p.id=li.product_id
      join public.purchases pu on pu.id=li.purchase_id and pu.user_id=li.user_id
      where lower(btrim(pr.email))=$1 and li.user_id<>$2 and lower(u.email) like '%@guest.2mrrw.local'
      and li.source='purchase' and pu.status='completed'
      and not exists (select 1 from public.library_items mine where mine.user_id=$2 and mine.product_id=li.product_id)
      order by li.id limit 201 for share of li, pr, u, pu, p`, [email, actor.id]);
    if (rows.length > 200) deny('ambiguous_recovery_requires_review');
    const targets = [];
    for (const row of rows) {
      const { rows: grants } = await tx.query(`select status, source_id, starts_at, ends_at from public.entitlements
        where user_id=$1 and resource_type='product' and resource_id=$2 and source_type='purchase'
        order by id for share`, [row.user_id, row.product_id]);
      // Ambiguous, revoked, not-yet-started and expired grants cannot become permanent rights.
      if (grants.length > 1 || grants.some(g => g.source_id !== row.purchase_id || g.status !== 'active' || (g.starts_at && new Date(g.starts_at).getTime() > now()) || (g.ends_at && new Date(g.ends_at).getTime() <= now()))) continue;
      const g = grants[0];
      targets.push({ kind: 'purchase', ...row, starts_at: g?.starts_at ? new Date(g.starts_at).toISOString() : null,
        ends_at: g?.ends_at ? new Date(g.ends_at).toISOString() : null });
    }
    if (targets.length > 200 || new Set(targets.map(t => t.product_id)).size !== targets.length) deny('ambiguous_recovery_requires_review');
    return targets;
  }
  return {
    async start({ actor, purpose, gift = null }) {
      const id = crypto.randomUUID(), handle = crypto.randomBytes(32).toString('hex');
      const code = String(crypto.randomInt(0, 100000000)).padStart(8, '0');
      const result = await transaction(async tx => {
        const email = await identity(tx, actor);
        await tx.query('select pg_advisory_xact_lock(hashtext($1))', [actor.id]);
        const { rows: recent } = await tx.query("select count(*)::int as n from public.ownership_email_challenges where user_id=$1 and created_at>$2", [actor.id, new Date(now() - 15 * 60000).toISOString()]);
        if (recent[0].n >= 3) deny('verification_rate_limited', 429);
        const targets = await targetsFor(tx, actor, email, purpose, gift);
        if (!targets.length) return { state: 'nothing_to_recover', targetCount: 0 };
        await tx.query("update public.ownership_email_challenges set state='cancelled' where user_id=$1 and state in ('pending','delivered')", [actor.id]);
        await tx.query(`insert into public.ownership_email_challenges
          (id,user_id,email,purpose,gift_id,handle_hash,code_hash,targets,created_at,expires_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`, [id, actor.id, email, purpose, gift?.id || null,
          hash(handle), digestCode(handle,id,purpose,code), JSON.stringify(targets), new Date(now()).toISOString(), new Date(now() + 5 * 60000).toISOString()]);
        return { state: 'pending', email, targetCount: targets.length };
      });
      if (result.state !== 'pending') return result;
      // Generic subject: the existing sender logs subjects on delivery failure. No code in subject/URL.
      let delivered = false;
      try { delivered = (await sendEmail({ to: result.email, sensitive: true, subject: '2MRRW — Verify your ownership request',
        text: `Your ownership verification code is ${code}. It expires in five minutes. This does not change your sign-in session.`,
        html: `<p>Your ownership verification code is <strong>${code}</strong>.</p><p>Expires in five minutes. If you did not request this, ignore this email.</p>` }))?.sent === true; } catch { /* fail closed */ }
      await transaction(tx => tx.query("update public.ownership_email_challenges set state=$2 where id=$1 and state='pending'", [id, delivered ? 'delivered' : 'cancelled']));
      if (!delivered) deny('email_delivery_unavailable', 503);
      return { state: 'code_sent', challengeId: id, purpose, targetCount: result.targetCount, handle, expiresIn: 300 };
    },
    async cancel({ actor, challengeId, purpose, handle }) {
      if (!/^[a-f0-9-]{36}$/.test(String(challengeId)) || !/^[a-f0-9]{64}$/.test(String(handle))) deny('invalid_challenge', 400);
      return transaction(async tx => {
        const email = await identity(tx, actor);
        const result = await tx.query("update public.ownership_email_challenges set state='cancelled' where id=$1 and user_id=$2 and email=$3 and purpose=$4 and handle_hash=$5 and state in ('pending','delivered') returning id", [challengeId,actor.id,email,purpose,hash(handle)]);
        if (!result.rows.length) deny('challenge_unavailable');
        return { state: 'cancelled' };
      });
    },
    async complete({ actor, challengeId, purpose, handle, code }) {
      if (!/^[a-f0-9-]{36}$/.test(String(challengeId)) || !/^[a-f0-9]{64}$/.test(String(handle))) deny('invalid_challenge', 400);
      let callbacks = [];
      const result = await transaction(async tx => {
        const email = await identity(tx, actor);
        const { rows } = await tx.query('select * from public.ownership_email_challenges where id=$1 for update', [challengeId]);
        const c = rows[0];
        if (!c || c.user_id !== actor.id || c.email !== email || c.purpose !== purpose || c.handle_hash !== hash(handle)) return { error: 'invalid_challenge', status: 403 };
        if (c.state !== 'delivered' || new Date(c.expires_at).getTime() <= now()) return { error: 'challenge_unavailable', status: 409 };
        const actual = digestCode(handle,c.id,purpose,String(code));
        if (!/^\d{8}$/.test(String(code)) || !crypto.timingSafeEqual(Buffer.from(c.code_hash,'hex'),Buffer.from(actual,'hex'))) {
          await tx.query("update public.ownership_email_challenges set attempts=attempts+1,state=case when attempts+1>=5 then 'locked' else state end where id=$1", [c.id]);
          return { error: 'invalid_code', status: 400 };
        }
        const current = await targetsFor(tx, actor, email, purpose, c.gift_id ? { id: c.gift_id } : null);
        if (!same(current,c.targets)) return { error: 'ownership_targets_changed', status: 409 };
        const port = transactionAdmin(tx);
        const targets = current.flatMap(t => t.kind === 'gift' ? [`gift:${t.id}`,`product:${t.slug}`] : [`purchase:${t.purchase_id}`,`product:${t.slug}`]);
        await withOwnershipProof({ userId: actor.id, email, purpose, targets, expiresAt: new Date(c.expires_at).getTime() }, async authority => {
          for (const target of current) {
            if (target.kind === 'gift') {
              const { rows: gifts } = await tx.query('select * from public.gifts where id=$1 for update', [target.id]);
              const { rows: products } = await tx.query('select * from public.products where id=$1 for share', [target.productId]);
              if (products[0]?.slug !== target.slug) deny('ownership_targets_changed');
              await claimGiftForUser(gifts[0], { id: actor.id, email }, { admin: port, authority, product: products[0] });
            } else await grantLibraryItems({ userId: actor.id, purchaseId: target.purchase_id, slugs: [target.slug], source: 'purchase',
              admin: port, authority, entitlementMetadata: { transferred_from_principal: target.user_id, transfer_reason: 'email_bound_rights' },
              entitlementWindow: { starts_at: target.starts_at || new Date(now()).toISOString(), ends_at: target.ends_at } });
          }
        });
        if (port.failure) throw port.failure;
        if (new Date(c.expires_at).getTime() <= now()) deny('challenge_unavailable');
        await tx.query("update public.ownership_email_challenges set state='consumed',consumed_at=$2 where id=$1", [c.id,new Date(now()).toISOString()]);
        callbacks = [...port.afterCommit, () => invalidateAccountStateCache(actor.id)];
        return { state: 'completed', targetCount: current.length };
      });
      if (result.error) deny(result.error,result.status);
      await Promise.allSettled(callbacks.map(fn => fn()));
      return result;
    },
  };
}
