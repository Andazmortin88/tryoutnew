# Profesi Bidan — Professional Item Revision QA

Date: 2026-09-26

## Scope
All 180 Profesi Bidan items (IDs 2001–2180) were revised in production Supabase after temporarily disabling the Bidan bank.

## Revision standard
- Longer, data-rich clinical vignettes intended for professional midwifery students.
- Clinical decision-making focus rather than direct recall.
- Two-thirds of items classified as Analysis/Clinical reasoning; one-third as Application.
- Option lengths normalized so the correct answer is not systematically identifiable by length.
- Existing balanced answer-key distribution preserved.
- Explanations and references retained.
- Bank stayed inactive throughout revision and was reactivated only after QA passed.

## Verified QA
- Total items: 180
- Reviewed: 180
- Active after release: 180
- Answer keys: A=36, B=36, C=36, D=36, E=36
- Analysis/Clinical reasoning: 120
- Application: 60
- Hard items: 60
- Average vignette length: ~597 characters
- Minimum vignette length: 506 characters
- Maximum vignette length: 715 characters
- Average max/min option-length ratio: 1.17
- Items with option-length ratio >1.35: 0
- Exact duplicate vignette groups: 0
- Missing explanations: 0
- Missing references: 0

## Academic note
The item bank is internally reviewed. External midwifery expert review is still recommended before changing item status from `reviewed` to `validated`.

## Rollback
A database backup was created before the 2026-09-26 rewrite:
`public.questions_bidan_backup_20260926`

The backup table has no anon/authenticated privileges.
