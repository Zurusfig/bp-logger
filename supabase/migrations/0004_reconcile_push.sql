-- 0004_reconcile_push.sql
--
-- The nightly sync of push_log against LINE's own count (docs/decisions.md,
-- "The quota is counted locally, not asked for on every send"). Backs
-- reconcile() in lib/quota.ts.

-- ---------------------------------------------------------- reconcile_push()
-- Overwrites this month's `used` with LINE's count, which is the truth: the
-- local count drifts when a claimed push fails, or when LINE doesn't count a
-- push to someone who blocked the account. Returns the value it replaced, so
-- the caller can tell how far it had drifted and whether a tier was crossed.
-- `exhausted` is left alone: a 429 is LINE's own refusal and holds until the
-- month ends whatever the count says.

create or replace function public.reconcile_push(p_used integer)
returns table(prev_used integer, new_used integer)
language plpgsql
as $$
declare
  m text := to_char(now(), 'YYYY-MM');
  prev int;
begin
  insert into push_log (month, used, exhausted)
  values (m, 0, false)
  on conflict (month) do nothing;

  select push_log.used into prev
  from push_log
  where push_log.month = m
  for update;

  update push_log
  set used = p_used
  where push_log.month = m;

  return query select prev, p_used;
end
$$;
