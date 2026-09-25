-- Emergency rollback for the 2026-09-26 Profesi Bidan professional-item rewrite.
-- Run only if the revised bank must be reverted.

begin;

update public.questions q
set area=b.area,
    subtopic=b.subtopic,
    vignette=b.vignette,
    option_a=b.option_a,
    option_b=b.option_b,
    option_c=b.option_c,
    option_d=b.option_d,
    option_e=b.option_e,
    correct_option=b.correct_option,
    explanation=b.explanation,
    difficulty=b.difficulty,
    cognitive_level=b.cognitive_level,
    blueprint_tag=b.blueprint_tag,
    reference_text=b.reference_text,
    review_status=b.review_status,
    last_reviewed_at=b.last_reviewed_at,
    is_active=b.is_active,
    updated_at=now(),
    program=b.program
from public.questions_bidan_backup_20260926 b
where q.id=b.id and q.program='bidan';

commit;

select program,
       count(*) total,
       count(*) filter(where is_active) active
from public.questions
where program='bidan'
group by program;
