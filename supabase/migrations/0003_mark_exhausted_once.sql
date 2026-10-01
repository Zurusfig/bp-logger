-- 0003_mark_exhausted_once.sql
--
-- mark_push_exhausted() now reports whether this call is the one that set the
-- flag, so lib/line.ts alerts once per month on a 429 instead of once per
-- request that hit it. Postgres can't change a function's return type with
-- create or replace, hence the drop.

drop function if exists public.mark_push_exhausted();

-- ------------------------------------------------------- mark_push_exhausted()
-- Set on a 429 from LINE (lib/line.ts). Stops every further claim this month
-- regardless of tier or remaining count, until next month's row starts fresh.
-- Returns true only when the flag was not already set. A concurrent caller
-- blocks on the row lock, then sees exhausted already true and gets false.

create function public.mark_push_exhausted()
returns boolean
language plpgsql
as $$
declare
  m text := to_char(now(), 'YYYY-MM');
begin
  insert into push_log (month, used, exhausted)
  values (m, 0, false)
  on conflict (month) do nothing;

  update push_log
  set exhausted = true
  where push_log.month = m and not push_log.exhausted;

  return found;
end
$$;
