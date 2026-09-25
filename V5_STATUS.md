# UKOM Health Pro V5

Development branch: `v5-security-hardening`

## Current scope

- Brand: **UKOM Health Pro** (tanpa kata AI)
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

## Profesi Bidan bank — internal reviewed-final

Internal doctoral-level/evidence-based revision completed 2026-09-25.

QA:
- 180/180 items revised.
- IDs 2001–2180.
- Answer keys balanced: A=36, B=36, C=36, D=36, E=36.
- Exact duplicate vignettes: 0.
- Duplicate A–E options within item: 0.
- 180/180 explanations include option-by-option rationale.
- 180/180 have references.
- `review_status=reviewed`.
- `is_active=false` until final validation and regression test.

The prior expert audit classified 48 items as major revision, 99 moderate, and 33 minor. All 180 have now been rewritten/refined accordingly. This is an **internal reviewed-final bank**, not an externally validated examination bank.

## Important evidence updates incorporated

- WHO 2025 consolidated postpartum haemorrhage guidance.
- WHO 2025 Medical Eligibility Criteria for Contraceptive Use, 6th edition.
- WHO 2025 Kangaroo Mother Care clinical practice guide.
- WHO postnatal care guidance.
- WHO antenatal and intrapartum guidance.
- Kemenkes Buku KIA 2024.
- Permenkes RI No. 2 Tahun 2025 tentang Penyelenggaraan Upaya Kesehatan Reproduksi.
- Kepmenkes HK.01.07/MENKES/320/2020 tentang Standar Profesi Bidan.
- Current Indonesian cervical-cancer screening direction using HPV DNA.

## Release gate

Do **not** merge this branch into `main` until:
1. Reviewed-final Bidan rows are imported to Supabase with `is_active=false`.
2. A dedicated Bidan test account confirms onboarding, trial, premium, area filtering, attempt submission, review, history and expiry.
3. Regression testing confirms Ners and D3 still work.
4. Midtrans Production smoke test succeeds.
5. External expert validation is completed/recommended before changing question rows to `validated`.
6. Only after the above may Bidan rows be changed to `is_active=true` and V5 merged to `main`.

## Production safety

The current production `main` branch must remain unchanged until all gates pass.


## Update 2026-09-25 — Bidan import and backend QA

- 180 REVIEWED-FINAL Profesi Bidan questions imported to Supabase.
- Imported as `review_status=reviewed` and `is_active=false`.
- IDs `2001–2180`.
- A/B/C/D/E answer keys: 36 each.
- Trial session locking test: PASS.
- Premium gate test: PASS.
- Premium 180-question retrieval (transactional rollback test): PASS.
- Cross-program isolation: PASS.
- Direct authenticated SELECT on question bank/backup tables: DENIED as intended.
- Ners active count remains 180.
- D3 active count remains 180.
- No Bidan trial attempts, exam sessions, or subscriptions were left behind by QA.


## Update 2026-09-25 — Frontend QA + persistent trial lock

Frontend static QA and three-program backend regression are now complete.

PASS:
- UKOM Health Pro branding only; legacy Nursing Pro branding removed.
- Profesi Bidan available in onboarding/profile.
- Program-specific Bidan areas match the 180-question bank.
- Payment UI no longer claims a bank VA method that may not be active.
- Premium expiry is shown when available.
- Program switching and sign-out clear stale local exam state.
- Trial anti-harvesting strengthened: the same unsubmitted 20-question set is reused even after its former expiry timestamp.
- Second trial submit returns `TRIAL_ALREADY_USED`.
- Ners, D3, and Bidan each return 20 trial questions and 180 Premium questions with correct program isolation.
- Disposable QA users/subscriptions/sessions were cleaned up after testing.
- Bidan remains `is_active=false`.

Controlled release files added:
- `supabase/V5_RELEASE_ACTIVATE_BIDAN.sql`
- `supabase/V5_ROLLBACK_DEACTIVATE_BIDAN.sql`
- `V5_FRONTEND_QA.md`

Remaining blockers:
1. Configure branded transactional email provider secrets.
2. Run one Midtrans Production end-to-end real-payment smoke test.
3. Merge/deploy and perform final live-browser smoke test.


## Update 2026-09-25 — payment idempotency hardening

Additional payment regression completed:

- Historical paid transactions with an already-linked subscription were backfilled with `subscription_applied_at`.
- This prevents a late Midtrans retry from extending an old purchase a second time.
- Atomic payment application test: first settlement activates one subscription; repeated settlement is idempotent.
- Repeated settlement leaves expiry unchanged.
- Payment-email outbox test: repeated queue calls keep one outbox row with the same ID.
- Webhook upgraded to version 13.
- Historical already-applied payments without an existing email outbox are skipped by the new branded-email path, preventing unexpected delayed emails.
- Final legacy `UKOM NURSING PRO AI` label in the exam screen was removed.

One historical D3 settlement has no directly linked subscription but the same user/program later received another D3 subscription. It is retained for manual accounting review rather than silently modifying entitlement.


## Update 2026-09-25 — email secrets configured by owner

The project owner confirmed that the Resend/Supabase email secrets have been entered.

Configured intent:
- `RESEND_API_KEY`
- `PAYMENT_EMAIL_FROM`
- admin/payment notification: `andazmortin@gmail.com`

Backend email code is active in `midtrans-webhook` and uses the configured secrets at runtime.

Important: the connector cannot read secret values back from Supabase, so **secret presence/delivery is not considered verified until a real webhook-driven email succeeds**.

Next release gate:
1. controlled Midtrans Production payment;
2. verify settlement, subscription, outbox, and email delivery;
3. only then activate Bidan + merge V5.
