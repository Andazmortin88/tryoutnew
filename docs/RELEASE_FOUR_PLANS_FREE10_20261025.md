# Release candidate — Four paid plans + 10-question trial

## Scope

- New free trial: **10 questions**, once per user and program.
- Previously created 20-question trial sessions can still finish without losing progress; existing consumed free trials remain consumed.
- Premium offers (single program): sprint_3 = Rp20.000 / 3 days; intensif_7 = Rp29.900 / 7 days; launch_30 = Rp40.000 / 30 days; promo_90 = Rp79.900 / 90 days.
- Paid entitlement expiry starts from verified payment and **adds the purchased days to a still-active entitlement**.
- No auto-renewals; Midtrans validates the charge against server-approved pricing.

## Production deployment sequence (must not skip)

1. Back up existing Supabase function definitions / schema and verify current production project ID.
2. Apply `supabase/sql/2026-10-25-four-plans-free-trial-10.sql` on a tested/staging database first; confirm 5 functions compile. Apply to production only after signoff.
3. Deploy `supabase/functions/create-midtrans-transaction/index.ts` after DB migration is live, preserving the previous verify-JWT configuration and merchant credentials. The signed webhook function need not change.
4. Build frontend (`npm ci && npm run build`) and publish compiled `dist` assets / HTML to the GitHub Pages serving branch, including SEO pages. Simply committing source to `main` does not republish a compiled Vite bundle.
5. Test all four packages with Midtrans sandbox credentials before any real purchases. Avoid test payments in live mode.

## Functional smoke tests

- Create **new** free sessions in Ners, D3, Bidan and Apoteker: each returns 10 questions and is limited to one trial per program/account. Repeat attempt must be rejected.
- Continue an existing 20-question trial issued before release; submit and verify results without editing its original IDs.
- For each package, verify displayed price, requested `plan`, reserved SQL amount, Midtrans gross amount, webhook status, subscription `plan_code`, and expiry increase by exactly 3 / 7 / 30 / 90 days.
- Confirm duplicate checkout request IDs cannot be reused to switch plan, and webhook replay does not extend access twice.
- Confirm currently active subscriber extension and absence of automatic renewal.
- Confirm failed, pending, cancelled, refunded payments do not open/extend premium access.
- Test mobile presentation, paywall keyboard navigation and SEO copy; verify server blocks nonpremium practice/tryout modes.

## Known release constraint

Source files, migration, and static CI checks are prepared on a GitHub feature branch only. **These changes are not live until the coordinated SQL migration, edge deployment, and compiled frontend release occur.**
