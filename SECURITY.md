# MovieBox Tracker Security Notes

Your Supabase anon key is allowed to be in browser code only when Row Level Security is protecting the table.

## What to check in Supabase

1. Open Supabase.
2. Go to Authentication and confirm you know whether this tracker is personal-only or shared.
3. Go to Table Editor, then `tracker_state`.
4. Open the table settings and make sure Row Level Security is enabled.
5. Review the policies for `select`, `insert`, `update`, and `delete`.

## Safest personal setup

For a private tracker, require sign-in and make each row belong to one user. That means adding a `user_id` column and creating policies that only allow:

```sql
auth.uid() = user_id
```

for reading, inserting, updating, and deleting.

## If you keep it anonymous

Anyone who gets the page and key may be able to write to the table unless policies are very narrow. At minimum, avoid putting private notes, passwords, client data, or sensitive personal data into the tracker.

## Local app protection added

The app now saves failed offline sync changes into browser storage. If the network drops or the browser closes before syncing, the queue is kept and retried later.
