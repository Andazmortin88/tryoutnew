# UKOM Health Pro V5 — Frontend & Backend QA Update

Date: 2026-09-25  
Branch: `v5-security-hardening`

## Frontend static QA — PASS

- Old `UKOM Nursing Pro` branding absent.
- `UKOM Health Pro` branding present.
- Profesi Bidan is available in onboarding and profile selection.
- Profile completeness accepts `ners`, `d3`, and `bidan`.
- Program-specific Bidan area list matches the imported bank.
- Setup receives dynamic program-specific areas.
- No direct browser SELECT from `questions`.
- No direct browser UPDATE of `profiles`.
- No direct browser INSERT into `attempts`.
- Payment UI no longer advertises a hard-coded VA method; Midtrans displays whatever methods are actually active.
- Dashboard shows Premium expiry when available.
- Program switching resets area/session-derived client state.
- Sign-out clears active local exam state.

## Trial anti-harvesting regression — PASS

A controlled QA user was created and removed in the same QA transaction.

Results:
- first trial: 20 questions;
- second RPC before submit: exact same 20 questions;
- forced session expiry then retry: exact same 20 questions;
- all questions matched the user's program;
- successful trial submit returned 20 review records;
- second trial submit returned `TRIAL_ALREADY_USED`.

The server now reuses one unsubmitted trial set indefinitely rather than allowing a new set after timeout.

## Three-program backend regression — PASS

Transactional QA with disposable users:

| Program | Trial 20 | Premium 180 | Program isolation | Premium access | Expiry returned |
|---|---:|---:|---|---|---|
| Profesi Ners | PASS | PASS | PASS | PASS | PASS |
| D3 Keperawatan | PASS | PASS | PASS | PASS | PASS |
| Profesi Bidan | PASS | PASS | PASS | PASS | PASS |

All QA users/subscriptions/sessions were removed after testing. Bidan questions returned to `is_active=false`.

## Current release state

- Ners active: 180
- D3 active: 180
- Bidan imported: 180
- Bidan reviewed: 180
- Bidan active: 0
- Bidan IDs: 2001–2180
- Bidan A/B/C/D/E keys: 36 each

## Remaining release blockers

1. Branded transactional email provider secrets are not yet configured.
2. Midtrans Production end-to-end payment smoke test with a real payment is still required.
3. Final browser smoke test on the deployed Production URL is required after merge.
4. Bidan activation must use the guarded release SQL.
