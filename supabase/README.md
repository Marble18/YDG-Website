# Managed account deployment

The files in this directory implement first-version username login and owner-managed customer/staff passwords.

## Prerequisites

- Supabase CLI authenticated with the YDG project owner account
- Project reference: `tfvwfpvdqcbgqnijhhpd`
- The existing `profiles` table and primary owner profile

Do not copy a secret or service-role key into this repository. Hosted Edge Functions automatically receive the project URL and server-side keys through their environment.

## Deploy

```powershell
npx --yes supabase@latest login
npx --yes supabase@latest link --project-ref tfvwfpvdqcbgqnijhhpd
npx --yes supabase@latest db push
npx --yes supabase@latest functions deploy username-login
npx --yes supabase@latest functions deploy account-admin
```

The login function intentionally has `verify_jwt = false` because it runs before a user has a session. It validates only a username/password and always returns a generic credential error. The account-admin function keeps JWT verification enabled and independently verifies that the caller has an active owner/staff profile before using admin APIs.

## Post-deploy checks

Deployment status: migration and both functions were deployed on 2026-08-05. The credential checks below were completed successfully against Netlify deploy preview #5.

1. Sign in as the primary owner using username `owner` and the current password.
2. Confirm email recovery still works only through **Owner password recovery**.
3. Create a customer with a temporary password of at least 6 characters; use a longer password whenever practical.
4. Sign out and sign in as that customer using the new username.
5. Confirm no customer password-change or recovery control is visible.
6. Sign in as owner and reset the customer password; confirm the old password fails and the new password works.
7. Disable the customer; confirm login fails. Enable the customer; confirm login works again.
8. Call `account-admin` without an owner session and confirm it returns 401/403.
9. Inspect the deployed frontend bundle and GitHub files; confirm no secret/service-role key exists.

## Rollback

Browser JSON backup/restore is retired. Never import authentication data from an old browser snapshot. If a deployment must be rolled back, restore the previous frontend release and remove/disable the new Edge Functions. Review the migration before reversing its RLS changes; never drop user profiles or Auth users as a rollback shortcut.

## PR #17 secure business backup

Deploy `business-backup` with JWT verification enabled and apply migration `202608110002_secure_business_backup_restore.sql`. Only the earliest active owner can export or restore. Database backups use `ydg-business-backup-v1`, schema version `202608110002`, exact row counts and SHA-256 integrity. Restore first creates a 15-minute dry-run plan, then performs a merge/upsert in one database transaction and writes an idempotency audit row. It never deletes unrelated rows or overwrites the caller's owner profile.

Private Storage objects are downloaded separately as a ZIP containing exact bucket paths, sizes, MIME types and per-object checksums. Its separate restore first validates the ZIP/CRC, manifest checksum, every object checksum, allowed bucket, safe path, image MIME/extension/signature and size, then creates a short-lived dry-run plan. Confirmation revalidates the same archive and current primary-owner authorization. Restore uses exact paths with `upsert: false`; matching files skip, different existing files report conflicts, and no wildcard deletion or overwrite is allowed. Storage is outside the PostgreSQL transaction, so partial operations return file-level success/failure and remain safely retryable; successfully created files become checksum-matching skips. Treat this as business-data portability, not provider-level backup/PITR.

Before PR #25, large Storage sets were inspected before object downloads and split through a short-lived server plan. Browser evidence later confirmed that the initial all-object scan could exceed the Edge Function execution limit. Migration `202608110004` still provides the Edge Function's least-privilege `service_role` table reads and restore-plan/audit writes used by restore flows. Safe Function logs contain an error code only (for example `DATABASE_TABLE_READ_FAILED`) and never include keys, tokens, object paths or private URLs.

PR #25 replaces the timeout-prone backup creation path with stateless bounded reads. Database pages contain at most 200 rows with stable `id` ordering and are verified in two database-only passes; the database download deliberately carries an empty Storage manifest because Storage metadata and bytes belong to the separate archive set. Storage directory pages contain at most 100 entries, and object bytes are fetched one approved exact path per request. The browser performs one initial Storage manifest scan, builds private ZIP parts locally (at most four files / 8 MB source bytes), verifies each saved part, and performs one final manifest scan before writing the completion index. Same-tab retry resumes verified parts; refresh or sign-out intentionally clears memory-only progress. This path creates no restore plan or backup-job database row and requires no migration. Existing restore validation/confirmation remains separate and unchanged.

The two-pass backup is not an MVCC snapshot across PostgreSQL and Storage. Run it during a quiet period; a detected source change produces an incomplete result. Desktop Chrome or Edge is required for verified multi-part Storage folder saving. Never treat loose ZIP parts without the matching `complete: true` index as a completed Storage backup.

Rollback: hide both restore pickers and undeploy `business-backup`, then revoke/drop the database preview/restore RPCs and helper after active plans expire. Retain `business_restore_audit` for history. The feature never overwrites or deletes Storage objects; if a partial restore created unwanted new files, review the returned exact `created` paths and remove only individually approved paths—never use a wildcard. No database business rows need to be deleted for feature rollback.
