# UKOM Health Pro V5

Development branch: `v5-security-hardening`

## Current scope

- Rebrand: **UKOM Health Pro**
- Programs:
  - Profesi Ners
  - D3 Keperawatan
  - Profesi Bidan
- Premium remains per program.
- Promo price remains Rp40.000 / 30 days / program.
- Free trial remains 20 questions / program.
- Profesi Bidan target bank: 180 vignette questions.

## Backend security work already applied in Supabase

- Direct browser writes to sensitive UKOM tables revoked.
- Browser roles cannot directly read the question bank or backup/import tables.
- Profile role cannot be changed through direct client table updates.
- Trial question set locked server-side through `exam_sessions`.
- Payment checkout origin restricted to the production GitHub Pages origin.
- Midtrans checkout rate guard and recent pending-order reuse.
- Atomic/idempotent paid-transaction -> subscription application.
- Program support extended to `ners`, `d3`, and `bidan`.
- Payment email outbox prepared for transactional email delivery.

## Deployment rule

Do **not** merge this branch into `main` until:
1. 180 Profesi Bidan questions complete academic review.
2. Major and moderate clinical revisions are resolved.
3. Bidan question rows are imported as inactive and tested with a Bidan account.
4. Regression testing confirms Ners/D3 login, trial, premium, attempts, and Midtrans still work.
5. Production payment and webhook smoke tests pass.

## Profesi Bidan review status

The draft bank contains 180 items. Expert review found:
- 48 major revisions
- 99 moderate revisions
- 33 minor revisions
- answer-key letter changes required: 0
- distractors and rationales require refinement before activation

Question content must remain `is_active=false` until final validation.
