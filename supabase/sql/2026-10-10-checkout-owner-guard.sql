-- Bind an idempotency key to its original buyer and program.
-- Preserve the existing server-side price, rate limit and entitlement logic.
begin;
do $patch$
declare
  v_oid regprocedure := 'public.reserve_checkout_order(uuid,text,text,uuid)'::regprocedure;
  v_definition text;
  v_needle text := E'  if found then\n    return jsonb_build_object(';
  v_pos int;
begin
  select pg_get_functiondef(v_oid) into v_definition;
  if position('CHECKOUT_REQUEST_OWNER_MISMATCH' in v_definition)>0 then return; end if;
  v_pos:=strpos(v_definition,v_needle);
  if v_pos=0 then raise exception 'CHECKOUT_PATCH_BASELINE_MISMATCH'; end if;
  v_definition:=overlay(v_definition placing E'  if found then\n    if v_existing.user_id is distinct from p_user_id or v_existing.program is distinct from p_program then\n      raise exception \'CHECKOUT_REQUEST_OWNER_MISMATCH\';\n    end if;\n    return jsonb_build_object(' from v_pos for length(v_needle));
  execute v_definition;
end $patch$;
commit;
