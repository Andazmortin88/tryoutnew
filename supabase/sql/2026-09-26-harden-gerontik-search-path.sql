-- Deployed to production on 2026-09-26. Keep built-ins resolved from pg_catalog.
alter function public.sync_gerontik_state(uuid,jsonb,text) set search_path to pg_catalog;
alter function public.trg_sync_gerontik_draft() set search_path to pg_catalog;
alter function public.trg_sync_gerontik_final() set search_path to pg_catalog;
