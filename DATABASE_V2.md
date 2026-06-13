# Database V2 Plan

This plan upgrades the tracker from one flexible `tracker_state` table into a cleaner set of tables. The goal is to make reports, templates, archive restore, alerts, history, and future multi-workspace support easier without breaking the current app.

## Safety Rules

1. Do not delete `tracker_state`.
2. Do not switch the app to V2 until V2 has been tested.
3. Keep ntfy reading the current system until the alert queries are intentionally migrated.
4. Back up/export Supabase data before running migration scripts.
5. Roll out in phases: create tables, migrate data, compare output, then switch app reads/writes.

## Why V2

The current table stores many concepts in one place:

- task completion rows
- counter rows
- skipped days
- deleted flags
- custom task JSON blobs
- recurring task JSON blobs
- notes JSON blobs
- archived task JSON blobs
- order JSON blobs

That works, but it makes analytics and alerts harder because the app has to parse row IDs and JSON text. V2 gives each concept a table.

## New Tables

### workspaces

Stores major tracker spaces such as ENIGMA, Dera, CareerPaddy, or future team spaces.

Key fields:

- `id`
- `name`
- `slug`
- `created_at`
- `updated_at`

### tasks

Stores the task definition. A recurring task should exist once here, while weekly completion lives separately.

Key fields:

- `id`
- `workspace_id`
- `source_task_id`
- `title`
- `brand`
- `day_key`
- `time_label`
- `task_type`
- `is_counter`
- `counter_max`
- `is_recurring`
- `is_template_task`
- `created_at`
- `updated_at`
- `archived_at`
- `deleted_at`

### task_instances

Stores a task's state for a specific week. This is where completions and counter values belong.

Key fields:

- `id`
- `task_id`
- `workspace_id`
- `week_key`
- `is_done`
- `counter_value`
- `completed_at`
- `created_at`
- `updated_at`

### task_notes

Stores notes per task per week.

Key fields:

- `id`
- `task_id`
- `workspace_id`
- `week_key`
- `note`
- `created_at`
- `updated_at`

### task_events

Stores activity history. This is the foundation for audit trail, better undo, reports, and debugging.

Event examples:

- `task_created`
- `task_edited`
- `task_completed`
- `task_reopened`
- `task_archived`
- `task_restored`
- `task_deleted`
- `task_duplicated`
- `task_moved`
- `counter_changed`
- `note_updated`

Key fields:

- `id`
- `task_id`
- `workspace_id`
- `week_key`
- `event_type`
- `old_value`
- `new_value`
- `created_at`

### day_states

Stores skipped/tracked day state per week.

Key fields:

- `id`
- `workspace_id`
- `week_key`
- `day_key`
- `is_skipped`
- `created_at`
- `updated_at`

### task_order

Stores manual task order per day and week.

Key fields:

- `id`
- `workspace_id`
- `week_key`
- `day_key`
- `task_ids`
- `created_at`
- `updated_at`

### templates

Stores reusable weekly plans.

Examples:

- Normal Week
- Light Week
- Campaign Week
- School Week
- Recovery Week

Key fields:

- `id`
- `workspace_id`
- `name`
- `description`
- `created_at`
- `updated_at`
- `archived_at`

### template_tasks

Stores tasks that belong to a template.

Key fields:

- `id`
- `template_id`
- `title`
- `brand`
- `day_key`
- `time_label`
- `task_type`
- `is_counter`
- `counter_max`
- `sort_order`

### alert_log

Stores ntfy or in-app alerts that were sent. This prevents duplicate alerts.

Key fields:

- `id`
- `workspace_id`
- `task_id`
- `week_key`
- `alert_type`
- `channel`
- `sent_at`
- `status`
- `dedupe_key`

## What Happens To Existing Data

Current row pattern | V2 destination
--- | ---
`blob_custom_tasks_<week>` | `tasks` plus `task_instances`
`blob_recurring_tasks` | `tasks` where `is_recurring = true`
`blob_task_notes_<week>` | `task_notes`
`blob_archived_tasks_<week>` | `tasks.archived_at` plus `task_events`
`deleted_<task_id>` | `tasks.archived_at` or `tasks.deleted_at`
`skip_day_<day>` | `day_states`
`order_<day>` | `task_order`
normal completion rows | `task_instances`
counter rows | `task_instances.counter_value`

## Migration Phases

### Phase 1: Add Tables

Run `supabase-v2-schema.sql` in Supabase. This creates V2 tables beside `tracker_state`.

No app behavior changes in this phase.

### Phase 2: Build Migration Helper

Create a temporary migration helper that:

1. Reads `tracker_state`.
2. Parses custom, recurring, notes, archive, order, skipped, completion, and counter rows.
3. Inserts equivalent data into V2 tables.
4. Logs migration counts.

### Phase 3: Compare Reports

Generate weekly reports from:

- old `tracker_state`
- new V2 tables

The numbers should match before switching the app.

### Phase 4: Add Data Adapter

Refactor app code to use helper methods:

- `loadTrackerWeek()`
- `saveTask()`
- `completeTask()`
- `archiveTask()`
- `restoreTask()`
- `saveNote()`
- `saveOrder()`
- `logTaskEvent()`

At first, these can still call `tracker_state`. Then their internals can switch to V2.

### Phase 5: Switch App To V2

After testing:

1. Switch reads to V2.
2. Switch writes to V2.
3. Keep `tracker_state` untouched as backup.

### Phase 6: Switch ntfy Later

Do not change ntfy during the initial V2 setup.

Later, update the alert checker to read:

- `tasks`
- `task_instances`
- `alert_log`

This will make alerts more reliable and prevent duplicates.

## Rollback Plan

If V2 has issues:

1. Keep the app using `tracker_state`.
2. Ignore V2 tables temporarily.
3. Fix migration/adapter logic.
4. Rerun migration into cleared V2 tables if needed.

Because `tracker_state` stays intact, rollback is simple.

## Recommended Next Step

Review `supabase-v2-schema.sql`, then create the tables in Supabase only after you are comfortable with the structure.
