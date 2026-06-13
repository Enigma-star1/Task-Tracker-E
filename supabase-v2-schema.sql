-- Task Tracker V2 schema (prefixed to avoid collisions with existing tables)
-- Safe rollout note:
-- This file creates new tables beside the existing tracker_state table.
-- It does not drop, rename, or modify tracker_state.

create extension if not exists pgcrypto;

create table if not exists public.tracker_v2_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tracker_v2_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.tracker_v2_workspaces(id) on delete cascade,
  source_task_id text null,
  title text not null,
  brand text not null default 'cp',
  day_key text null check (day_key in ('sat','sun','mon','tue','wed','thu','fri') or day_key is null),
  time_label text not null default 'Anytime',
  task_type text not null default 'production',
  is_counter boolean not null default false,
  counter_max integer null,
  is_recurring boolean not null default false,
  is_template_task boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz null,
  deleted_at timestamptz null
);

create table if not exists public.tracker_v2_task_instances (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tracker_v2_tasks(id) on delete cascade,
  workspace_id uuid not null references public.tracker_v2_workspaces(id) on delete cascade,
  week_key date not null,
  is_done boolean not null default false,
  counter_value integer null,
  completed_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(task_id, week_key)
);

create table if not exists public.tracker_v2_task_notes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tracker_v2_tasks(id) on delete cascade,
  workspace_id uuid not null references public.tracker_v2_workspaces(id) on delete cascade,
  week_key date not null,
  note text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(task_id, week_key)
);

create table if not exists public.tracker_v2_task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid null references public.tracker_v2_tasks(id) on delete set null,
  workspace_id uuid not null references public.tracker_v2_workspaces(id) on delete cascade,
  week_key date null,
  event_type text not null,
  old_value jsonb null,
  new_value jsonb null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tracker_v2_day_states (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.tracker_v2_workspaces(id) on delete cascade,
  week_key date not null,
  day_key text not null check (day_key in ('sat','sun','mon','tue','wed','thu','fri')),
  is_skipped boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(workspace_id, week_key, day_key)
);

create table if not exists public.tracker_v2_task_order (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.tracker_v2_workspaces(id) on delete cascade,
  week_key date not null,
  day_key text not null check (day_key in ('sat','sun','mon','tue','wed','thu','fri')),
  task_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(workspace_id, week_key, day_key)
);

create table if not exists public.tracker_v2_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.tracker_v2_workspaces(id) on delete cascade,
  name text not null,
  description text null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz null,
  unique(workspace_id, name)
);

create table if not exists public.tracker_v2_template_tasks (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.tracker_v2_templates(id) on delete cascade,
  title text not null,
  brand text not null default 'cp',
  day_key text not null check (day_key in ('sat','sun','mon','tue','wed','thu','fri')),
  time_label text not null default 'Anytime',
  task_type text not null default 'production',
  is_counter boolean not null default false,
  counter_max integer null,
  sort_order integer not null default 0
);

create table if not exists public.tracker_v2_alert_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.tracker_v2_workspaces(id) on delete cascade,
  task_id uuid null references public.tracker_v2_tasks(id) on delete set null,
  week_key date null,
  alert_type text not null,
  channel text not null default 'ntfy',
  sent_at timestamptz not null default timezone('utc', now()),
  status text not null default 'sent',
  dedupe_key text not null,
  unique(dedupe_key)
);

create index if not exists idx_tracker_v2_tasks_workspace_day on public.tracker_v2_tasks(workspace_id, day_key);
create index if not exists idx_tracker_v2_tasks_recurring on public.tracker_v2_tasks(workspace_id, is_recurring) where deleted_at is null;
create index if not exists idx_tracker_v2_tasks_active on public.tracker_v2_tasks(workspace_id, archived_at, deleted_at);
create index if not exists idx_tracker_v2_task_instances_week on public.tracker_v2_task_instances(workspace_id, week_key);
create index if not exists idx_tracker_v2_task_instances_task_week on public.tracker_v2_task_instances(task_id, week_key);
create index if not exists idx_tracker_v2_task_notes_week on public.tracker_v2_task_notes(workspace_id, week_key);
create index if not exists idx_tracker_v2_task_events_week on public.tracker_v2_task_events(workspace_id, week_key, created_at);
create index if not exists idx_tracker_v2_alert_log_week on public.tracker_v2_alert_log(workspace_id, week_key, sent_at);

insert into public.tracker_v2_workspaces (name, slug)
values ('ENIGMA', 'enigma')
on conflict (slug) do nothing;

-- RLS should be enabled before the app writes to these tables.
-- Policies depend on whether this remains personal-only or gets login/workspace auth.
-- Do not paste strict auth.uid() policies until the app has login support.

