# UKOM Health Pro — V6 Final Release Status

Date: 2026-09-26 (WIB)

This is an internal engineering and academic-QA release record. It is not an external security certification and not a human professional-panel validation.

## Closed audit blockers

### Exam integrity
- Permanent trial entitlement is independent from attempt history.
- Legacy history-delete RPC is not executable by authenticated clients.
- All exam modes use server-issued sessions.
- Trial issues exactly 20 questions.
- Tryout issues exactly 180 questions with a 180-minute server deadline.
- Exact question set and option permutation are stored server-side.
- Option order is randomized server-side.
- Submit is idempotent per session.
- Active progress can be saved/resumed.
- Attempt review is ownership checked.

Fresh rollback QA on Ners, D3 and Bidan confirmed:
- 20/20 trial questions from the correct program.
- Server-side randomization forced.
- Duplicate submit returns the same attempt.
- Trial entitlement survives history deletion.
- 180/180 tryout questions from the correct program.
- One session produces one attempt.
- Tryout deadline is 180 minutes.

### Payment and webhook
- Legacy `midtrans-transaction` is retired as an HTTP 410 stub with JWT verification enabled (v23).
- Production checkout uses the atomic reservation/idempotency path.
- Subscription updates are serialized by user/program.
- Payment reversals are recorded for financial review.
- Midtrans webhook verifies signature, amount and Get Status response.
- Email uses claim/lease, provider idempotency and HTML escaping.

### Production supply chain
PR #3 replaced browser-time React/Babel/Tailwind/Supabase CDN execution with a compiled production bundle:
- pinned exact package versions;
- committed npm lockfile (v3);
- Vite build on Node 20 passed;
- local hashed JS/CSS assets;
- CSP retained;
- no runtime unpkg/jsDelivr/Tailwind Play/Babel references in production index.

Merge commit: `e3b728055cbcc11bf4736c263bf7c2094fcf4ba4`.

GitHub Pages deployment for the compiled bundle: PASS.

### Question bank
Current inventory:
- Profesi Ners: 180 active / 180 internally reviewed
- D3 Keperawatan: 180 active / 180 internally reviewed
- Profesi Bidan: 180 active / 180 internally reviewed
- A/B/C/D/E = 36 each per program
- Missing explanation = 0
- Missing reference = 0
- Deterministic A-B-C-D-E answer-key cycle removed.
- D3 normalized semantic duplicate-core groups using the audit rule = 0.

Final Bidan semantic cleanup also removed the remaining generic filler and the specifically detected mismatched distractor rationales for diabetes prakonsepsi, IMS prakonsepsi, hiperemesis, anemia kehamilan, severe preeclampsia and high-risk gestational diabetes.

## Release classification

Engineering/business-rule blockers in the supplied pre-launch audit have been remediated and regression tested.

The product may be described as an **independent practice platform with an internally reviewed question bank**. It must not be described as an official UKOM source, externally professor-validated bank, or psychometrically validated predictor unless that separate evidence is obtained.

Remaining assurance activities:
1. Physical Android/iPhone/Samsung Internet acceptance testing.
2. Whole-service disaster-recovery restore drill.
3. External human nursing/midwifery panel review.
4. Psychometric pilot with target learners.

These are tracked as post-remediation assurance gates rather than unresolved application logic defects.
