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

Deployment status: migration and both functions were deployed on 2026-08-05. The real credential checks below must still be completed before merge.

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

Do not restore authentication data from browser JSON backups. If a deployment must be rolled back, restore the previous frontend release and remove/disable the new Edge Functions. Review the migration before reversing its RLS changes; never drop user profiles or Auth users as a rollback shortcut.
