# PR #9 Phase 1 — Pre-production Demo Data Audit

Audit date: 2026-08-05

Supabase project: `YDG Website` (`tfvwfpvdqcbgqnijhhpd`, Singapore)

Mode: read-only; no live database or Storage records were changed or deleted.

## Backup status

Local, git-ignored backup directory:

`C:\Users\kohte\OneDrive\Documents\YDG Website\.codex-tmp\pr9-phase1-20260805`

Created files:

- `database-data.json`: data snapshot for `public`, `auth`, and `storage` tables. Treat as sensitive because Auth data is included.
- `database-schema-metadata.json`: columns, constraints, indexes, RLS policies, public functions, and triggers.
- `storage-manifest.json`: bucket configuration and exact object paths; it does not contain the image bytes.
- `audit-summary.json`: sanitized counts, sample identifiers, dependencies, policies, and buckets.

The files are deliberately excluded by `.gitignore`; do not commit or share them. SHA-256 hashes were generated after creation. The normal Supabase CLI SQL dump could not run because Docker Desktop is not installed, so this is a JSON/metadata safety snapshot rather than a directly restorable `pg_dump` archive.

Supabase Free Plan limitations:

- Dashboard database-backup downloads and automatic backups are not included on Free Plan.
- Point-in-time recovery is not included on Free Plan.
- Database backups do not contain Storage object bytes. Storage needs a separate object backup; this phase produced the requested file manifest only.

## Exact live counts

| Data source | Count | Phase 2 proposal |
|---|---:|---|
| `products` | 22 | Delete all audited demo product IDs |
| `categories` | 8 | Delete after products, if confirmed |
| `inventory_movements` | 0 | Nothing to delete |
| `orders` | 0 | Nothing to delete |
| `order_items` | 0 | Nothing to delete |
| `cart_items` | 0 | Nothing to delete |
| `profiles` | 2 | Preserve owner; delete `test1` customer |
| Auth users | 2 | Preserve owner; delete the managed `test1` Auth user |
| `product-images` objects | 6 | Delete only the exact paths listed below, after DB cleanup |
| `delivery-proofs` objects | 0 | Nothing to delete |
| `voucher_settings` | 1 | Preserve |
| `app_settings` | 1 | Preserve |

## Products proposed for deletion

All 22 are current test/demo catalogue rows. ID prefixes are shown for human review; the local audit snapshot retains complete UUIDs for exact Phase 2 targeting.

| ID prefix | Product | Category | Active | Stock |
|---|---|---|---:|---:|
| `a577f0fb` | note book | BOOK | yes | 100 |
| `a6c0e967` | note book 1 | bag | yes | 100 |
| `b1480d02` | NOTE BOOK NO.A4-21 | BOOK | yes | 120 |
| `7e0c90ea` | test | BOOK | yes | 100 |
| `56dfeae0` | Note book | BOOK | yes | 120 |
| `640a0f78` | test1 | BOOK | yes | 82 |
| `402bddd7` | test2 | BOOK | yes | 26 |
| `65a30598` | test3 | BOOK | yes | 1 |
| `7305586b` | test4 | eraser | yes | 11 |
| `92c15aeb` | test5 | eraser | yes | 1 |
| `98a3701a` | test6 | eraser | yes | 1 |
| `b773ca06` | test6 | pencil | yes | 1 |
| `53364554` | test7 | pencil | yes | 1 |
| `a1982548` | test8 | cap | yes | 1 |
| `705e63ce` | test9 | cap | yes | 1 |
| `4677993b` | test10 | cap | yes | 1 |
| `165cd9ba` | test11 | file | yes | 1 |
| `c8200399` | test12 | file | yes | 1 |
| `8271d2c6` | test12 | paper | yes | 1 |
| `e1031589` | test13 | ph | yes | 1 |
| `c6e66df7` | test14 | BOOK | yes | 1 |
| `303ab17c` | NOTE BOOK SU-16172 | BOOK | yes | 100 |

## Categories requiring confirmation

All eight categories are currently used only by the 22 audited demo products. After those products are removed they will all be unused.

| ID prefix | Category | Current products |
|---|---|---:|
| `fb648be5` | BOOK | 9 |
| `88cc2755` | bag | 1 |
| `7e5aa730` | eraser | 3 |
| `0042b2c2` | pencil | 2 |
| `67376a36` | cap | 3 |
| `e09eac56` | file | 2 |
| `6c7a42ff` | paper | 1 |
| `d871b824` | ph | 1 |

Recommendation: delete all eight after deleting the demo products. This needs explicit confirmation because category names may be intended for the real catalogue.

## Accounts

- Preserve primary owner Auth/profile: ID prefix `65f629cb`, username `owner`, role `owner`, active.
- Proposed deletion: managed test customer ID prefix `a31af45a`, username `test1`, role `customer`, active; its synthetic login email is under `accounts.ydg.invalid`.
- Phase 2 must verify the complete primary owner UUID server-side and refuse to delete it. Customer deletion must use the protected server/admin path; no service-role credential may enter the frontend, logs, or GitHub.

## Storage cleanup manifest

Delete only these exact `product-images` paths after the corresponding product rows are removed:

1. `303ab17c-7feb-4e75-88e2-8ed9f66126ab/1785900068830.jpg`
2. `b1480d02-bbe0-4a17-a7dc-bf9130f9edc4/1785900099105.jpg`
3. `56dfeae0-fbc8-4072-8384-bd441fcd7587/1785915596841.jpg`
4. `7e0c90ea-6a5d-436d-b0be-bd9bbbfa1e9b/1785916070234.jpg`
5. `a577f0fb-81d6-422d-a3d9-09c1ea1c24ce/1785918013120.jpg`
6. `a6c0e967-f235-4b7c-ab68-cb987339abc2/1785918039964.jpg`

`delivery-proofs` contains no objects. Bucket definitions and Storage policies must be preserved.

## Settings requiring confirmation

Database values:

- Voucher: title `Yadanar Theingi Stationery & Fancy`, colour `#2563eb`, footer `Thank you for your order.`
- App settings: maintenance mode is off.

Recommendation: preserve both rows because they are usable shop settings, not obvious test records.

## Browser Local Storage demo source

The application still seeds browser-local demo content when `yt-stationery-demo-v2` is absent:

- 8 demo products
- 3 demo users (`owner`, `mya`, `aung`)
- 3 demo orders
- 3 inventory movements
- demo voucher/settings

Other keys include `yt-stationery-auto-backup-v2`, `yt-cart-v2`, `yt-theme-v2`, and `yadanar-voucher-paper-size`. Actual values vary by browser/device and were not read. Phase 2 should make an application-versioned, safe reset that removes stale demo commerce data without deleting theme or voucher paper preference unless explicitly requested.

## Dependencies and safe Phase 2 order

Important foreign keys:

- carts → profiles/products (`ON DELETE CASCADE`)
- order items → orders (`CASCADE`) and products (`SET NULL`)
- inventory movements → products (restrict/default) and orders (`SET NULL`)
- products → categories (`SET NULL`)
- profiles → Auth users (`CASCADE` from Auth user)

Proposed transaction order:

1. Re-audit counts and verify the target UUID/path snapshot has not drifted.
2. Resolve and lock the primary owner UUID; abort unless exactly one active owner exists.
3. Delete only target carts, order items, inventory movements, and orders inside one transaction.
4. Delete only the 22 target product UUIDs and, if confirmed, the eight now-unused target category UUIDs in that transaction.
5. Commit only if post-delete database counts and dependency checks match expectations.
6. Delete the six exact Storage paths individually after database commit; never use a wildcard or bucket-wide delete.
7. Delete only the `test1` managed Auth user through a protected server-side admin operation with an owner-ID denylist.
8. Apply the versioned browser demo-state reset in application code.
9. Run the requested owner, recovery, RLS, empty-state, CRUD/upload, stock, export, unauthorized-access, and Netlify validations.

No Phase 2 action has been performed.

## Confirmation gate

Before Phase 2, confirm all three points explicitly:

1. Delete all 22 audited products, the six exact product-image objects, and the `test1` customer/Auth account.
2. Delete all eight audited categories after they become unused.
3. Preserve the voucher and app settings rows exactly as they are.
