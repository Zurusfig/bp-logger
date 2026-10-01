-- 0002_push_log.sql
--
-- The safety net for the 2026-09 LINE quota outage (docs/incidents.md). Backs
-- lib/quota.ts: a local counter against the LINE Free plan's 300 sends/month
-- cap, checked before pushMessage() would otherwise find out the hard way.

-- ---------------------------------------------------------------- push_log
-- One row per calendar month (server-side, i.e. UTC — see the note on
-- current_date in 0001_init.sql). Written only through claim_push() and
-- mark_push_exhausted() below; no application code touches this table
-- directly, the same convention api_usage already uses.

create table if not exists public.push_log (
  month     text    not null,
  used      integer not null default 0,
  exhausted boolean not null default false,
  constraint push_log_pkey primary key (month)
);

alter table public.push_log enable row level security;

-- ------------------------------------------------------------- claim_push()
-- Atomically claims one send for the given tier's reserve floor
-- (lib/quota.ts TIER_FLOOR) and increments the month's counter in the same
-- statement, so concurrent claims from a fan-out can't race past the
-- reserve. `for update` takes a row lock on the month's push_log row for the
-- duration of this function's implicit transaction.
--
-- Fails closed: exhausted, budget already spent, or a claim that would drop
-- the remaining count to or below the tier's floor, all return claimed=false
-- without touching `used`.

create or replace function public.claim_push(p_floor integer, p_budget integer)
returns table(claimed boolean, used integer, exhausted boolean)
language plpgsql
as $$
declare
  m text := to_char(now(), 'YYYY-MM');
  cur_used int;
  cur_exhausted boolean;
begin
  insert into push_log (month, used, exhausted)
  values (m, 0, false)
  on conflict (month) do nothing;

  select push_log.used, push_log.exhausted into cur_used, cur_exhausted
  from push_log
  where push_log.month = m
  for update;

  if cur_exhausted or (p_budget - cur_used) <= p_floor then
    return query select false, cur_used, cur_exhausted;
    return;
  end if;

  update push_log
  set used = push_log.used + 1
  where push_log.month = m
  returning push_log.used into cur_used;

  return query select true, cur_used, cur_exhausted;
end
$$;

-- ------------------------------------------------------- mark_push_exhausted()
-- Set on a 429 from LINE (lib/line.ts). Stops every further claim this month
-- regardless of tier or remaining count, until next month's row starts fresh.

create or replace function public.mark_push_exhausted()
returns void
language plpgsql
as $$
declare
  m text := to_char(now(), 'YYYY-MM');
begin
  insert into push_log (month, used, exhausted)
  values (m, 0, true)
  on conflict (month) do update set exhausted = true;
end
$$;
