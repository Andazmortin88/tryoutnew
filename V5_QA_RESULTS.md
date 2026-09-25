# UKOM Health Pro V5 — QA Results

Date: 2026-09-25

## Database import

Profesi Bidan REVIEWED-FINAL bank has been imported into Supabase with the release gate still closed.

- Program: `bidan`
- IDs: `2001–2180`
- Total: 180
- `review_status=reviewed`: 180
- `is_active=true`: 0
- `is_active=false`: 180
- Answer keys: A/B/C/D/E = 36 each
- Difficulty: easy 18 / medium 126 / hard 36
- Cognition: Understanding 18 / Application 108 / Analysis-Clinical reasoning 54

The question bank is intentionally **not stored in this public GitHub repository**.

## Transactional backend QA

All tests below were executed inside a database transaction and rolled back, so no test subscription, attempt, session, or activation was retained.

### Trial session lock
- First trial fetch: 20 questions — PASS
- Repeated trial fetch before submit: 20 questions — PASS
- Repeated fetch returns the same question set — PASS
- All returned IDs belong to Profesi Bidan — PASS
- Trial submit accepted 20 questions — PASS
- Review returned after submit: 20 items — PASS
- Trial exam session marked submitted — PASS
- Trial attempt created during test — PASS

### Premium gate
- Non-premium `tryout` request returns `PREMIUM_REQUIRED` — PASS
- Temporary active Bidan subscription returned 180 questions — PASS
- All 180 IDs belonged only to Profesi Bidan — PASS

### Question-bank security
- authenticated direct SELECT on `questions` — DENIED / PASS
- authenticated direct SELECT on backup question table — DENIED / PASS
- authenticated direct SELECT on legacy `bank soal` — DENIED / PASS

### Regression counts
- Active Profesi Ners questions: 180
- Active D3 Keperawatan questions: 180
- Active Profesi Bidan questions after rollback: 0

## Remaining release gates

1. Frontend browser QA on the V5 branch.
2. Google-login onboarding test for `bidan`.
3. Midtrans checkout smoke test for `bidan` without real production charge until explicitly approved.
4. Transactional email provider secrets and email-delivery test.
5. Optional external expert validation before changing question status from `reviewed` to `validated`.
6. Activate Bidan questions only after the above tests.
7. Merge `v5-security-hardening` into `main` only after Ners/D3/Bidan regression testing passes.
