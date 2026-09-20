-- Advisor-driven hygiene after `server_enforcement` (applied 2026-09-20 as
-- migration `guard_hygiene`). None of these change behaviour — they remove
-- schema surface the advisors flagged:
--   - pin the search_path of assert_ticket_lines (pure function, but the
--     linter is right that it should be pinned)
--   - revoke client EXECUTE on the trigger guard functions and the auth
--     signup trigger (trigger firing checks the trigger OWNER's privileges,
--     so revoking from clients breaks nothing)
--   - anon keeps no privileges on profiles / manager_approvals (rows were
--     already RLS-protected; this also hides them from GraphQL introspection)
--   - anon cannot call app_role() (authenticated keeps it — RLS policy
--     expressions evaluate with the caller's privileges and need it)

alter function public.assert_ticket_lines(jsonb) set search_path = public;

revoke all on function public.assert_ticket_lines(jsonb) from public, anon, authenticated;
revoke all on function public.guard_tickets() from public, anon, authenticated;
revoke all on function public.guard_payments() from public, anon, authenticated;
revoke all on function public.guard_bookings() from public, anon, authenticated;
revoke all on function public.guard_folio_lines() from public, anon, authenticated;
revoke all on function public.guard_folios() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

revoke all on table public.profiles from anon;
revoke all on table public.manager_approvals from anon;
revoke execute on function public.app_role() from anon;
