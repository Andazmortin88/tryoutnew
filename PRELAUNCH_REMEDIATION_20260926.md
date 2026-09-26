# UKOM Health Pro — Pre-Launch Remediation Status

Date: 2026-09-26 (WIB)

This document records remediation performed against the 26 September 2026 pre-launch audit. It is an engineering and internal academic QA record, not an external security certification or human professional-panel validation.

## Release blockers closed

### Trial entitlement and exam integrity
- Trial entitlement is stored independently from attempt history.
- Deleting attempt history no longer resets trial eligibility.
- All modes use server-issued exam sessions.
- Server stores the exact question set and option permutation.
- Trial requires exactly 20 questions.
- Tryout requires exactly 180 active questions.
- Tryout deadline is generated and enforced server-side at 180 minutes.
- Option randomization is forced server-side; the browser cannot request deterministic option order.
- Submit is idempotent per session; retry returns the same attempt.
- Attempt review is ownership-checked.
- Active progress can be saved to the server and resumed after refresh/login.

### Payment hardening
- Legacy `midtrans-transaction` endpoint is retired and returns HTTP 410; JWT verification is enabled.
- Active checkout uses `create-midtrans-transaction`.
- Checkout uses an atomic reservation/idempotency request ID and reuses an in-progress/pending order.
- Subscription application is serialized by user/program.
- Multiple valid payments extend one entitlement instead of creating overlapping subscriptions.
- Payment events record settlement and later reversal/refund states.
- Webhook validates Midtrans signature and performs Get Status verification for sensitive flows.
- Email delivery uses an outbox claim/lease, provider idempotency, and HTML escaping.
- Direct browser SELECT on `transactions` and `subscriptions` is revoked; access status is exposed through vetted RPCs.

### Question-bank remediation
Current production inventory:
- Profesi Ners: 180 active / 180 reviewed
- D3 Keperawatan: 180 active / 180 reviewed
- Profesi Bidan: 180 active / 180 reviewed
- A/B/C/D/E = 36 each for every program
- Missing explanation = 0
- Missing reference = 0

The deterministic A-B-C-D-E key cycle found in the audit is removed:
- Ners cycle-position matches: 37/180
- D3 cycle-position matches: 41/180
- Bidan cycle-position matches: 37/180

D3:
- 180 items reviewed.
- Previous semantic core duplicates removed/replaced; current normalized duplicate-core groups: 0.
- Placeholder “validasi reviewer sebelum publikasi” references: 0.
- Cognitive distribution now includes analysis and application.

Bidan:
- Audit examples with mismatched rationale/context were rewritten.
- Meta-padding that disclosed likely diagnoses/actions was removed.
- LAM item states all three criteria.
- Informed-consent item explicitly states the right to withdraw consent.
- Neonatal sepsis item now includes stabilization, protocol-based pre-referral care, and urgent referral.
- Postpartum cases no longer contain fetal-heart/labour-progress context after birth.

Ners:
- Severe-pre-eclampsia item 60 was reframed so nursing actions occur while emergency obstetric escalation/treatment is already activated.
- Placeholder reviewer references were removed.
- Answer-length cueing was reduced and key positions were re-permuted.

Academic status remains **internally reviewed**, not externally validated. Human specialty review and psychometric pilot testing remain recommended before making claims of professional validation.

## Acceptance QA executed

Disposable-account tests were run and cleaned up after execution.

### Trial matrix — Ners / D3 / Bidan
For all three programs:
- Trial returned exactly 20 questions.
- Server forced option randomization even when the client requested `false`.
- Saved progress was returned on resume.
- Re-submitting the same session returned the same attempt.
- Clearing attempt history did not restore trial entitlement.

### Tryout matrix — Ners / D3 / Bidan
For all three programs:
- Exactly 180 questions were issued.
- Server deadline = 180 minutes.
- Duplicate submit returned the same attempt ID.
- Exactly one attempt row existed for one session.

### Deadline enforcement
- A tryout artificially moved past its server deadline was rejected with `SESSION_EXPIRED`.
- No attempt was created.

### Ownership
- A second account could not retrieve another account’s attempt review.

### Payment logic (database-only rollback QA)
- Same checkout request ID reused the same transaction.
- Two different valid payments produced one subscription row.
- Second payment extended expiry by 30 days.
- Settlement/refund events were recorded.
- Refund status was recorded without granting access twice.

### Backup/restore
- Release-candidate question snapshot contains 540 rows.
- A controlled one-row mutation/restore test matched the snapshot exactly.
- Test was rolled back.

## Frontend/UI fixes already present
- FAQ and onboarding instructions.
- Bright sky-blue visual system.
- Mobile exam layout with horizontal question navigation.
- Mobile safe areas and `100dvh`.
- Tablet layout for 769–1023 px.
- Server-deadline timer recalculated from wall-clock time and refreshed after visibility changes.
- Persistent in-exam error messages and retry.
- Busy/disabled states for start, submit, checkout and review.
- History can reopen attempt review.
- Same-tab payment navigation avoids blocked-popup failure.
- Darker sky-blue primary CTA improves text contrast.
- `prefers-reduced-motion` support.
- Keyboard focus indicators, radio semantics, aria-current and modal dialog semantics.
- “Readiness” wording changed to internal practice performance, not a validated UKOM pass prediction.
- Privacy, Terms, Payment/Refund and Support pages added.
- SEO description/OpenGraph/favicon metadata added.

## Remaining release checks that require a different validation channel
1. Physical-device QA: Android Chrome, Samsung Internet and iPhone Safari, including 320/360/390/430/768/820/1024/1366 widths and portrait/landscape.
2. Browser performance: Lighthouse/Core Web Vitals on the deployed site.
3. Production supply-chain migration: **CLOSED** — production now uses a compiled Vite/Tailwind bundle, exact pinned dependencies, npm lockfile, hashed local JS/CSS assets, and CSP; runtime Babel/Tailwind/React/Supabase CDNs were removed in PR #3.
4. Operational restore drill for the whole service, not only the question-bank row snapshot.
5. External human nursing/midwifery content review and subsequent psychometric pilot (difficulty, discrimination, distractor functioning, reliability).
6. If password sign-in is enabled later, enable Supabase leaked-password protection.

## Release statement
Core business-rule blockers from the audit (trial reset, server exam integrity, session recovery, submit idempotency, legacy payment bypass, checkout/subscription race, payment reversal recording, email concurrency, key-cycle exposure, major audited question inconsistencies, and runtime CDN supply-chain exposure) have been remediated and regression-tested.

A public launch should not claim that the item bank is “externally validated” or equivalent to official UKOM. Use “latihan independen” and “internally reviewed” until human-panel and psychometric validation are completed.
