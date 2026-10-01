-- 0005_anthropic_usage.sql
--
-- Token counts for every Claude call this app makes, per day and model. Backs
-- lib/spend.ts and the daily spend message (docs/decisions.md, "Anthropic spend
-- is counted locally"). The API has no balance endpoint, and the Admin API cost
-- report isn't available to individual accounts, so this is the only spend
-- figure the app can see.

-- ---------------------------------------------------------- anthropic_usage
-- One row per (Bangkok calendar day, model). The day is Bangkok's, not UTC, so
-- "today" in the 22:00 Bangkok report means the whole local day so far. Written
-- only through record_anthropic_usage() below.

create table if not exists public.anthropic_usage (
  day                date    not null,
  model              text    not null,
  calls              integer not null default 0,
  input_tokens       bigint  not null default 0,
  output_tokens      bigint  not null default 0,
  cache_write_tokens bigint  not null default 0,
  cache_read_tokens  bigint  not null default 0,
  constraint anthropic_usage_pkey primary key (day, model)
);

alter table public.anthropic_usage enable row level security;

-- ------------------------------------------------- record_anthropic_usage()
-- Adds one call's usage to today's row for that model, creating the row on the
-- first call of the day. A single upsert, so concurrent calls from one batch of
-- photos can't lose an increment.

create or replace function public.record_anthropic_usage(
  p_model       text,
  p_input       bigint,
  p_output      bigint,
  p_cache_write bigint,
  p_cache_read  bigint
)
returns void
language plpgsql
as $$
begin
  insert into anthropic_usage as u
    (day, model, calls, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens)
  values
    ((now() at time zone 'Asia/Bangkok')::date, p_model, 1,
     p_input, p_output, p_cache_write, p_cache_read)
  on conflict (day, model) do update set
    calls              = u.calls + 1,
    input_tokens       = u.input_tokens + excluded.input_tokens,
    output_tokens      = u.output_tokens + excluded.output_tokens,
    cache_write_tokens = u.cache_write_tokens + excluded.cache_write_tokens,
    cache_read_tokens  = u.cache_read_tokens + excluded.cache_read_tokens;
end
$$;
