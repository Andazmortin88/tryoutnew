# UKOM Health Pro V5 — QA / Regression Test Plan

Branch: `v5-security-hardening`  
Production branch: `main`  
Rule: **do not merge until all release gates pass.**

## A. Database gate — Profesi Bidan

Expected after reviewed-final import:

```text
program       bidan
count         180
review_status reviewed
is_active     false
IDs           2001–2180
keys          A/B/C/D/E = 36 each
```

No Bidan question may be exposed to students while `is_active=false`.

## B. Bidan onboarding

- New/existing test user can select **Profesi Bidan**.
- Saved profile program becomes `bidan`.
- Dashboard displays **Profesi Bidan**.
- Area filter contains only:
  - Pranikah & Prakonsepsi
  - Kehamilan
  - Persalinan
  - Nifas & Menyusui
  - Neonatus/Bayi/Balita
  - KB & Kesehatan Reproduksi
  - Etik-Komunikasi-Manajemen

## C. Trial security

After Bidan questions are activated in a controlled test:
- Trial returns at most 20 questions.
- Calling the question RPC again before submit returns the same server-side trial set.
- Trial cannot be used again after successful submit.
- No correct answer or explanation is delivered before submit.
- Submitted questions must belong to the issued program/session.

## D. Premium / payment

- Price shown: Rp40.000 / 30 days / program.
- Checkout item name uses **UKOM Health Pro**.
- Ners payment cannot activate D3/Bidan.
- D3 payment cannot activate Ners/Bidan.
- Bidan payment activates Bidan only.
- Verified settlement/capture creates or extends subscription by 30 days.
- Repeated webhook does not add another 30 days.
- Payment amount mismatch does not activate access.
- Invalid Midtrans signature does not activate access.

## E. Payment email

- Successful verified payment creates one outbox record.
- Duplicate webhook does not create duplicate email.
- When provider secrets are configured, successful payment sends one branded confirmation.
- Email failure must not revoke or block a valid subscription.

## F. Exam / result

For all three programs:
- Learning mode loads questions.
- Tryout loads up to 180 program-matching questions.
- Option randomization preserves scoring.
- Flagging works.
- Submit stores one attempt.
- Score is calculated server-side.
- Explanation appears only after submit.
- Wrong-question remediation uses the correct program.
- History only shows the signed-in user's attempts.

## G. Regression — Ners and D3

Before merging V5:
- Google login works.
- Existing Ners profile loads.
- Existing D3 profile loads.
- Trial-used state is preserved.
- Existing Premium subscription is preserved.
- Existing attempt history is preserved.
- Ners never receives D3/Bidan questions.
- D3 never receives Ners/Bidan questions.
- Existing Midtrans Production flow remains functional.

## H. Release decision

Only after all checks pass:
1. external expert validation is recommended;
2. mark approved Bidan rows as `validated`;
3. set approved Bidan rows `is_active=true`;
4. run final payment smoke test;
5. merge PR into `main`.
