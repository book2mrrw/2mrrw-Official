# 2MRRW DB Audit Delivery Manifest

**Audit date:** 2026-05-22  
**Bundle ID:** DB-Audit-2026-05-22  
**Method:** Static repo analysis (migrations + `src` grep). No live Supabase query in this run.

## Repository commits (at audit time)

| Repo | Commit | Subject | Timestamp |
|------|--------|---------|-----------|
| artist-platform | `46ce92d3ffb8165c7f964782cdaf12ff2a68c7be` | chore: checkpoint — media deps (howler, three, zustand) | (see `artist-platform-commit.txt`) |
| 2MRRW-Control-System | `18dd1032cfa38e61deec5522a53e2e50e51c28c5` | chore: recovery checkpoint snapshot 20260522-142635 | (see `control-system-commit.txt`) |

## Bundle contents

| File | Description |
|------|-------------|
| `DB-Audit-2026-05-22.md` | Full audit report |
| `DELIVERY_MANIFEST.md` | This file |
| `artist-platform-commit.txt` | `git log -1` for artist-platform |
| `control-system-commit.txt` | `git log -1` for control system |
| `artist-platform-migrations.txt` | Paths under `supabase/migrations/` |
| `control-system-migrations.txt` | Paths under `src/db/migrations/` |
| `code-tables-grep-summary.txt` | Distinct `admin.from("…")` table names from storefront code |

## Prior reference input

- **Found:** `/Users/recharge/Downloads/-DB-Audit-2026-05-22.zip` (2,279 bytes)
- **Contents:** Prompt/README only (`CURSOR-DB-AUDIT-PROMPT.md`) — not a prior completed audit. This delivery supersedes that bundle as the first full static audit.

## Output copies (requested)

- `/Users/recharge/artist-platform/docs/reports/DB-Audit-2026-05-22.zip`
- `/Users/recharge/Downloads/DB-Audit-2026-05-22.zip`
- `/Users/recharge/Downloads/-DB-Audit-2026-05-22.zip` (optional dash-prefixed alias)
