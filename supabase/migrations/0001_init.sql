-- 0001_init.sql
--
-- The schema of the live Supabase project, captured 2026-08-30.
--
-- Tables, columns, types, nullability, defaults and indexes come from two
-- SQL-editor exports kept alongside this file:
--   Supabase Snippet Untitled query.csv       -> pg_indexes
--   Supabase Snippet Untitled query (1).csv   -> information_schema.columns
--
-- Foreign keys, check constraints, RLS state, the bump_usage() body and the
-- storage bucket are not in those exports. They were read separately from the
-- SQL editor and are reproduced here.
--
-- gen_random_uuid() needs no extension: Supabase runs Postgres 15+, where it is
-- built in, and Supabase installs extensions into the extensions schema anyway.

-- ---------------------------------------------------------------- settings
-- One row per household. Created by ensureHousehold() the first time the bot
-- sees a group (lib/db.ts:32). Parent of members and readings.

create table if not exists public.settings (
  group_id        text        not null,
  patient_name    text,
  last_visit_date date,
  tz              text        not null default 'Asia/Bangkok'::text,
  created_at      timestamptz not null default now(),
  slots           jsonb       not null default '[{"key": "wake", "from": "04:00", "label": "ตื่นนอน", "remind_at": "09:00"}, {"key": "after_med", "from": "08:30", "label": "หลังยาเช้า", "remind_at": "09:00"}, {"key": "bedtime", "from": "15:00", "label": "ก่อนนอน", "remind_at": "22:00"}]'::jsonb,
  constraint settings_pkey primary key (group_id)
);

-- The slots default mirrors DEFAULT_SLOTS in lib/slot.ts. Keep them in step.

-- ----------------------------------------------------------------- members
-- One row per LINE user. user_id is the primary key, which is why a user can
-- belong to only one household at a time (lib/db.ts:56).

create table if not exists public.members (
  user_id          text        not null,
  group_id         text        not null,
  display_name     text,
  notify_ok        boolean     not null default true,
  is_admin         boolean     not null default false,
  created_at       timestamptz not null default now(),
  notify_all       boolean     not null default true,
  notify_reminders boolean     not null default true,
  constraint members_pkey primary key (user_id),
  constraint members_group_id_fkey foreign key (group_id)
    references public.settings (group_id) on delete cascade
);

create index if not exists members_group_idx on public.members using btree (group_id);

-- ---------------------------------------------------------------- readings

create table if not exists public.readings (
  id             uuid        not null default gen_random_uuid(),
  group_id       text        not null,
  sender_id      text        not null,
  taken_at       timestamptz not null,
  posted_at      timestamptz not null,
  slot           text,
  reading_date   date,
  sys            smallint,
  dia            smallint,
  pulse          smallint,
  irregular_flag boolean,
  source         text        not null default 'image'::text,
  image_path     text,
  image_hash     text,
  ocr_raw        jsonb,
  confidence     real,
  needs_review   boolean     not null default false,
  review_note    text,
  edited_by      text,
  edited_at      timestamptz,
  reviewed_by    text,
  reviewed_at    timestamptz,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  constraint readings_pkey primary key (id),
  constraint readings_group_id_fkey foreign key (group_id)
    references public.settings (group_id) on delete cascade,

  -- Null is always allowed: a field the OCR could not read is stored as null and
  -- goes to the review queue. These bounds match validate() in lib/ocr.ts.
  constraint sys_range   check (sys   is null or (sys   between 60 and 260)),
  constraint dia_range   check (dia   is null or (dia   between 30 and 160)),
  constraint pulse_range check (pulse is null or (pulse between 30 and 180)),

  -- Same shape the settings API enforces on a slot key
  -- (app/api/settings/route.ts:48).
  constraint slot_shape  check (slot is null or slot ~ '^[a-z_]{2,20}$')
);

-- Deduplication (FR-1.6). Partial and unique, so the same image posted twice
-- collides but two different photos minutes apart do not. Soft-deleted rows drop
-- out of the index, so re-posting an image whose reading was deleted works again.
-- This is what lets findByHash() use maybeSingle() (lib/db.ts:107).
create unique index if not exists readings_hash_uniq
  on public.readings using btree (group_id, image_hash)
  where image_hash is not null and deleted_at is null;

-- Every read path filters deleted_at is null, so all three of these are partial.
create index if not exists readings_group_date_slot_idx
  on public.readings using btree (group_id, reading_date desc, slot)
  where deleted_at is null;

create index if not exists readings_group_taken_idx
  on public.readings using btree (group_id, taken_at desc)
  where deleted_at is null;

-- Review queue. Indexes group_id only; needs_review lives in the predicate.
create index if not exists readings_review_idx
  on public.readings using btree (group_id)
  where needs_review and deleted_at is null;

-- ----------------------------------------------------------------- pending
-- The fields a failed OCR left null, waiting for the sender to type them.
-- One outstanding request per user. Expiry is enforced in application code, not
-- here: getPending() deletes the row when it reads a stale one (lib/db.ts:243).
-- Nothing sweeps rows for a user who never replies.

create table if not exists public.pending (
  user_id    text        not null,
  reading_id uuid,
  missing    text[]      not null default '{}'::text[],
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint pending_pkey primary key (user_id),
  constraint pending_reading_id_fkey foreign key (reading_id)
    references public.readings (id) on delete cascade
);

-- ---------------------------------------------------------- reminders_sent
-- Idempotency for the reminder cron. The primary key IS the mechanism: a slot
-- already claimed by an earlier run today conflicts and drops out silently, so
-- only newly recorded slots get mentioned in the message
-- (app/api/cron/reminders/route.ts:79, lib/db.ts:341).

create table if not exists public.reminders_sent (
  group_id     text        not null,
  reading_date date        not null,
  slot_key     text        not null,
  sent_at      timestamptz not null default now(),
  constraint reminders_sent_pkey primary key (group_id, reading_date, slot_key)
);

-- --------------------------------------------------------------- api_usage
-- Per-group daily call counters behind DAILY_CALL_CAP (lib/prefilter.ts:11).
-- Written only through bump_usage() below; no application code touches this
-- table or its columns directly.

create table if not exists public.api_usage (
  group_id     text    not null,
  day          date    not null,
  ocr_calls    integer not null default 0,
  triage_calls integer not null default 0,
  constraint api_usage_pkey primary key (group_id, day)
);

-- ------------------------------------------------------------- bump_usage()
-- The counter behind the daily cap. Increments both columns for (group, today)
-- and returns ocr_calls after the increment, which worker.ts compares against
-- DAILY_CALL_CAP with a strict > (lib/worker.ts:125). A triage-only bump passes
-- ocr = 0, so it returns the unchanged OCR count and never moves the cap.
--
-- current_date resolves in the database's timezone, which is UTC on Supabase.
-- The daily cap therefore rolls over at 07:00 Bangkok time, not local midnight.

create or replace function public.bump_usage(g text, ocr integer, triage integer)
returns integer
language plpgsql
as $$
declare total int;
begin
  insert into api_usage (group_id, day, ocr_calls, triage_calls)
  values (g, current_date, ocr, triage)
  on conflict (group_id, day) do update
    set ocr_calls    = api_usage.ocr_calls    + excluded.ocr_calls,
        triage_calls = api_usage.triage_calls + excluded.triage_calls
  returning ocr_calls into total;
  return total;
end
$$;

-- --------------------------------------------------------------------- RLS
-- Enabled on all six tables, with no policies on any of them.
--
-- With RLS on and no policy present, Postgres denies every row to ordinary
-- roles. The anon and authenticated keys can therefore read nothing here, which
-- is the desired posture: no browser ever talks to these tables directly.
--
-- Two things follow. The service role bypasses RLS entirely, and that is the key
-- the server connects with (lib/db.ts:13), so none of this constrains the
-- application. And because no policy expresses the household rule, nothing in
-- the database knows that a reading belongs to one group. Isolation between
-- households still rests entirely on the group_id filter written by hand into
-- every query. RLS closes the door on anon access; it does not enforce tenancy.

alter table public.settings       enable row level security;
alter table public.members        enable row level security;
alter table public.readings       enable row level security;
alter table public.pending        enable row level security;
alter table public.reminders_sent enable row level security;
alter table public.api_usage      enable row level security;

-- ------------------------------------------------------------------ storage
-- lib/db.ts:25 sets BUCKET = 'readings'. Private, so every photo is served
-- through a short-lived signed URL rather than a public object URL.

insert into storage.buckets (id, name, public)
values ('readings', 'readings', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------
--
-- VALUE VALIDATION IS SPLIT. The three range checks above are enforced in both
-- places: here, and in validate() in lib/ocr.ts. The other two rules that
-- validate() applies, sys > dia and a gap of more than 10 between them, exist
-- only in application code. A direct SQL write can still produce a reading with
-- a diastolic above its systolic.
--
-- The range checks are not purely belt and braces. completeReading()
-- (lib/db.ts:196) writes typed corrections without calling validate() and
-- without checking the update for an error, so a value outside these bounds is
-- now rejected by the database while the bot still reports success. See the
-- handover notes; this is a live bug, not a schema problem.
--
-- ON DELETE CASCADE. Deleting a settings row removes that household's members
-- and readings. Deleting a reading removes any pending fill request pointing at
-- it. Note that readings themselves are soft-deleted by the application, which
-- sets deleted_at and never issues a DELETE, so the readings -> pending cascade
-- only fires on a manual cleanup.
--
-- UNUSED COLUMNS. members.is_admin, and the created_at / sent_at columns on
-- every table, are read by no application code. is_admin in particular looks
-- like a feature that was planned and never built.
