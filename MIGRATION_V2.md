# Migration V2 Plan

This file explains how to move existing `tracker_state` data into the Database V2 tables without breaking the live tracker or ntfy.

## Migration Goal

Move data from the current flexible state table:

```text
tracker_state
```

into structured V2 tables:

```text
workspaces
tasks
task_instances
task_notes
task_events
day_states
task_order
templates
template_tasks
alert_log
```

The old table must remain untouched during the first migration pass.

## Non-Negotiable Safety Rules

1. Do not delete `tracker_state`.
2. Do not switch app reads to V2 during migration.
3. Do not switch ntfy to V2 during migration.
4. Export/backup `tracker_state` before running any migration helper.
5. Make migration idempotent: running it twice should not create duplicate tasks.
6. Compare old report totals and V2 report totals before switching anything.

## Workspace Mapping

Default workspace:

```text
name: ENIGMA
slug: enigma
```

Rows with ordinary week keys such as:

```text
2026-06-06
```

belong to workspace `enigma`.

Rows with prefixed week keys such as:

```text
dera_2026-06-06
```

should eventually map to a separate workspace:

```text
name: Dera
slug: dera
```

For the first migration pass, migrate only normal ENIGMA rows unless we intentionally include Dera.

## Old Row Types

### Custom Task Blob

Old ID:

```text
blob_custom_tasks_<week_key>
```

Example:

```text
blob_custom_tasks_2026-06-06
```

Old data:

```json
[
  {
    "id": "custom_1781154554649",
    "dayKey": "thu",
    "brand": "cp",
    "text": "Dance",
    "time": "6:10 am",
    "oneTime": false,
    "recurring": false,
    "taskType": "production"
  }
]
```

V2 destination:

- `tasks`
- `task_instances`

Mapping:

Old field | V2 field
--- | ---
`id` | `tasks.source_task_id`
`text` | `tasks.title`
`brand` | `tasks.brand`
`dayKey` | `tasks.day_key`
`time` | `tasks.time_label`
`taskType` | `tasks.task_type`
`recurring` | `tasks.is_recurring`
`oneTime` | event/tag only for now
week key from blob ID | `task_instances.week_key`

Create one `task_instances` row for that week.

### Recurring Task Blob

Old ID:

```text
blob_recurring_tasks
```

V2 destination:

- `tasks`

Mapping:

- `is_recurring = true`
- `source_task_id = old id`
- `day_key`, `brand`, `title`, `time_label`, and `task_type` from JSON.

Completion remains per week in `task_instances`.

### Task Notes Blob

Old ID:

```text
blob_task_notes_<week_key>
```

Old data:

```json
{
  "task_id": "note text"
}
```

V2 destination:

- `task_notes`

Mapping:

Old item | V2 field
--- | ---
object key | lookup task by `source_task_id`
object value | `task_notes.note`
week key from blob ID | `task_notes.week_key`

If the task cannot be found, log it as an orphan note in migration output.

### Archived Tasks Blob

Old ID:

```text
blob_archived_tasks_<week_key>
```

V2 destination:

- `tasks.archived_at`
- `task_events`

Mapping:

- If task exists by `source_task_id`, set `archived_at`.
- If task does not exist, create it first from the archived task JSON.
- Add a `task_archived` event.

### Deleted Flag

Old ID:

```text
deleted_<task_id>
```

V2 destination:

- `tasks.archived_at` for normal archive behavior.
- `tasks.deleted_at` only if the user chose Delete Forever.

For first migration, treat old `deleted_` rows as archived unless we can prove they were hard-deleted.

### Skipped Day

Old ID:

```text
skip_day_<day_key>
```

V2 destination:

- `day_states`

Mapping:

Old field | V2 field
--- | ---
week_key | `day_states.week_key`
day key from ID | `day_states.day_key`
is_done | `day_states.is_skipped`

### Manual Order

Old ID:

```text
order_<day_key>
```

Old `text_val`:

```json
["task_id_1", "task_id_2"]
```

V2 destination:

- `task_order.task_ids`

Mapping:

- Convert old source task IDs to V2 task UUIDs where possible.
- Keep unresolved source IDs in a migration warning list.

### Completion Row

Old ID:

```text
mon_blog
custom_1781154554649
```

V2 destination:

- `task_instances`

Mapping:

Old field | V2 field
--- | ---
`id` | lookup `tasks.source_task_id`
`week_key` | `task_instances.week_key`
`is_done` | `task_instances.is_done`
`updated_at` | `task_instances.updated_at`

If `is_done = true`, set `completed_at = updated_at`.

### Counter Row

Old row:

```text
id = sat_reupload
counter_val = 1
```

V2 destination:

- `tasks.is_counter = true`
- `task_instances.counter_value`

Mapping:

Old field | V2 field
--- | ---
`id` | lookup `tasks.source_task_id`
`counter_val` | `task_instances.counter_value`
`counter_val > 0` | `task_instances.is_done = true`

## Template Tasks

The current built-in weekly schedule lives in `app.js` as `BASE_SCHEDULE_TEMPLATES`.

Migration helper should create these as normal `tasks` with:

```text
source_task_id = old template ID
is_template_task = true
```

This lets old completion rows like:

```text
mon_blog
sat_pray
fri_meet
```

resolve to real task rows.

Later, templates can be moved into `templates` and `template_tasks`.

## Recommended Migration Order

1. Ensure V2 schema exists.
2. Create/fetch workspace `enigma`.
3. Insert built-in template tasks from `BASE_SCHEDULE_TEMPLATES`.
4. Insert recurring tasks from `blob_recurring_tasks`.
5. Insert custom tasks from `blob_custom_tasks_<week>`.
6. Insert task instances from completion and counter rows.
7. Insert notes from `blob_task_notes_<week>`.
8. Insert skipped days from `skip_day_<day>`.
9. Insert manual order from `order_<day>`.
10. Insert archived task data from `blob_archived_tasks_<week>`.
11. Apply old `deleted_<task_id>` flags as archived.
12. Write migration events into `task_events`.
13. Print a validation report.

## Idempotency Rules

Use these uniqueness rules to avoid duplicates:

Table | Dedupe key
--- | ---
`tasks` | `workspace_id + source_task_id`
`task_instances` | `task_id + week_key`
`task_notes` | `task_id + week_key`
`day_states` | `workspace_id + week_key + day_key`
`task_order` | `workspace_id + week_key + day_key`
`alert_log` | `dedupe_key`

Important: the current `tasks` table does not yet enforce `workspace_id + source_task_id` uniqueness. Add a unique index later after checking for nulls and duplicates.

Suggested future index:

```sql
create unique index if not exists idx_tasks_workspace_source
on public.tasks(workspace_id, source_task_id)
where source_task_id is not null;
```

## Validation Checklist

Run these checks after migration:

- Number of migrated custom tasks matches old custom blob count.
- Number of recurring tasks matches old recurring blob count.
- Completion totals match old weekly report.
- Counter totals match old weekly report.
- Notes count matches old notes object key count.
- Archived task count matches old archive blob count plus deleted flags.
- Skipped day count matches old skip rows.
- Manual order rows exist for days with saved order.
- No conflict markers or JSON parse errors in migration log.

## Report Comparison

For each migrated week, compare:

Metric | Old source | V2 source
--- | ---
Total tasks | current app report | `tasks + task_instances`
Done tasks | current app report | `task_instances.is_done`
Completion % | current app report | calculated from V2
Reuploads | current app report | `task_instances.counter_value`
Archived count | archive blob | `tasks.archived_at`
Skipped days | skip rows | `day_states`

Do not switch the app until these match closely.

## ntfy Safety

Do not change ntfy in the first migration.

Current alert flow should keep reading the old system until V2 is proven.

Later ntfy should use:

- `tasks`
- `task_instances`
- `alert_log`

The `alert_log.dedupe_key` should prevent duplicate alerts.

Example dedupe key:

```text
enigma:2026-06-13:mon_meet:meeting_20m
```

## Rollback

If migration output looks wrong:

1. Keep the app on `tracker_state`.
2. Ignore V2 tables.
3. Fix migration logic.
4. Clear V2 migrated rows only if needed.
5. Rerun migration.

Never delete `tracker_state` during rollback.

## Next Build Step

After this plan is reviewed, build a temporary migration helper:

```text
tools/migrate-tracker-state-v2.html
```

or

```text
tools/migrate-tracker-state-v2.js
```

The helper should run manually, show a dry-run report first, and require confirmation before writing V2 data.
