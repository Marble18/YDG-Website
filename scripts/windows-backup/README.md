# YDG Windows backup scripts

These scripts replace the retired Owner Dashboard backup/restore UI. They are intentionally not self-configuring: repository files contain no password, access token or private backup content.

## Backup contract

- `Invoke-YdgDatabaseBackup.ps1` creates `roles.sql`, `schema.sql` and `data.sql` with the official Supabase CLI, records non-sensitive row counts, and verifies SHA-256 hashes before publishing a completed set.
- `Invoke-YdgStorageBackup.ps1` uses the official Supabase Storage REST API over Windows HTTPS because the CLI's legacy Storage gateway is unreliable on the target network. Its service-role key is read only from Windows Credential Manager and is never written to config, arguments, logs or backup files. The first successful run backs up `product-images` and existing `delivery-proofs`; later runs download only new/changed `product-images` based on immutable object ID, update timestamp and size. Remote deletions are recorded but never delete an older backup.
- Generation happens under the configured local staging root. A set is copied to a unique `.incoming-*` directory on Google Drive, verified again, marked with `BACKUP_COMPLETE`, then renamed on the destination volume.
- Failed/partial staging directories are retained for diagnosis and are never labelled complete. No retention deletion is implemented.
- Logs contain event codes, counts and run IDs only. Scripts never log CLI output, passwords, tokens, SQL data or object contents.

## Configuration (not performed automatically)

1. Copy `config.example.json` to a private path such as `%LOCALAPPDATA%\YDGBackup\config.json`; replace the user/CLI paths. Never place that runtime file in Git or Google Drive.
2. Create local `staging`/`logs` and destination `database`, `storage\sets`, `storage\manifests` directories.
3. After explicit approval, run `Set-YdgDatabaseCredential.ps1` interactively to store the database password as `YDG/Supabase/DatabasePassword` in Windows Credential Manager.
4. After separate high-privilege approval, run `Set-YdgServiceRoleCredential.ps1` interactively to store the service-role key as `YDG/Supabase/ServiceRoleKey`. This credential is scoped operationally by the script to Storage list/download requests, but the key itself remains privileged and must be rotated if exposed.
5. Confirm Supabase CLI is authenticated for the same Windows user and linked only to project `tfvwfpvdqcbgqnijhhpd`.
6. Run each backup manually and validate it with `Test-YdgBackupSet.ps1`. Do not run a live restore.
7. Only after the manual run is reviewed, run `Install-YdgBackupTasks.ps1`. Defaults are database daily at 20:00 and Storage Sunday at 20:30. `StartWhenAvailable` handles a missed schedule after the computer starts and the user signs in; each task retries three times at 30-minute intervals and overlapping runs are denied by a mutex.

Google Drive for Desktop must be mounted as `G:` and the Windows user must be signed in. Task logon type is deliberately `Interactive` so the user-scoped CLI authentication, Credential Manager entry and Google Drive mount remain available.

## Restore validation limitation

`Test-YdgBackupSet.ps1` verifies set completeness and file checksums without changing data. A full SQL restore test requires a separately approved disposable local PostgreSQL/Supabase environment. The scripts contain no live restore command and must never be pointed at the production database for validation.
