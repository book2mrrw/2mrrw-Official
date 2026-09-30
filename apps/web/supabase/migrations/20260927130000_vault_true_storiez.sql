-- Documentariez -> True Storiez.
--
-- A follow-up rather than an edit to 20260927120000: that migration has already
-- been applied, so it is history now. On a fresh database the pair runs in
-- order and lands on the same result.
--
-- The slug moves too. vault_content_progress references vault_content(id), not
-- slug (008_vault_entitlement_persistence.sql:64), so nothing points at the old
-- string and renaming it cannot orphan a row.

begin;

update public.vault_content
   set category    = 'True Storiez',
       slug        = 'true-storiez-long-form',
       description = 'Real stories, told long form — full arcs, not clips.'
 where category in ('Documentariez', 'Documentaries', 'True Storiez');

commit;
