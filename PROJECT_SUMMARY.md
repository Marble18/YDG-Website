# YDG Ecommerce — Project Summary

ဒီဖိုင်ကို Frontend, Backend/Data နှင့် Bug/Maintenance အလုပ်အားလုံးအတွက် shared source of truth အဖြစ် သုံးပါမည်။ ကြီးမားသော feature သို့မဟုတ် architecture ပြောင်းလဲမှု merge ပြီးတိုင်း update လုပ်ရပါမည်။

Last updated: 2026-08-10

## 1. Project goal

Yadanar Theingi Stationery & Fancy အတွက် မြန်မာအသုံးပြုသူများ mobile ဖြင့်လွယ်ကူစွာ အသုံးပြုနိုင်သော ecommerce system တည်ဆောက်ရန် ဖြစ်သည်။ Owner က products, stock, customers နှင့် orders ကို စီမံနိုင်ပြီး customer က catalogue ကြည့်ခြင်း၊ order တင်ခြင်းနှင့် voucher ကြည့်ခြင်းတို့ လုပ်နိုင်ရမည်။

## 2. Current architecture

- Frontend: Vanilla HTML, CSS and JavaScript (`index.html`, `styles.css`, `app.js`)
- Source control: GitHub repository `Marble18/YDG-Website`
- Production hosting: Netlify (`workers.dev` ကို production link အဖြစ် မသုံးပါ)
- Authentication, database and files: Supabase
- Supabase frontend connection: Project URL + publishable key only
- Secret/service-role keys: frontend, GitHub နှင့် browser console ထဲ လုံးဝမထည့်ရ

## 3. Completed work

### Authentication

- Owner email/password login ကို Supabase Auth သို့ပြောင်းပြီးပြီ။
- Session restore, owner role check, inactive-account check နှင့် logout ပါပြီးပြီ။
- Hard-coded demo passwords နှင့် plaintext local account creation ကို application flow မှ ဖယ်ရှားပြီးပြီ။
- Local Storage အဟောင်းထဲမှ password fields ကို sanitize လုပ်ထားသည်။
- Password recovery email, recovery-link handling နှင့် new-password form ပါပြီးပြီ။

### Catalogue and inventory

- Categories, products နှင့် inventory movements ကို Supabase မှ ဖတ်/ရေးသည်။
- Owner product CRUD, image upload, stock adjustment နှင့် category price adjustment ပါပြီးပြီ။
- Product images ကို public `product-images` bucket တွင် သိမ်းသည်။
- Product form supports case-insensitive existing-category autocomplete with keyboard, pointer and touch selection.
- Category names are trimmed and protected by a case-insensitive database unique index; historical case-only duplicates are consolidated by migration.
- Product photos support browse and drag/drop with identical JPEG/PNG/WebP, 500 KB, preview and status validation.
- Products store `unit` (`pcs` or `box`) and a positive whole-number `minimum_order_quantity`; existing rows default to `pcs` and `1`.
- Owner Products provides template-based `.xlsx` export with category and active/inactive filters, sequential numbering, embedded product photos and a Unit column added after the original template columns.
- Excel export is generated in the browser from the versioned template asset; the source template is never overwritten and no secret key is involved.
- Customer Catalogue and Owner Products use database-side category filters, debounced name search, an exact result count and stable `created_at, id` pagination with 20 products per request.
- Product images use native lazy loading. Catalogue screens include loading skeletons, empty results, retryable errors and Load More states for desktop and mobile.
- Excel export deliberately uses a separate paged full-result fetch because exporting all matching rows is an explicit owner action; normal catalogue pages never fetch all products.
- PR #12 adds a manager Categories page for active owners and staff. It lists active/inactive status and a database-counted total covering both active and inactive products.
- Empty-category deletion is exposed only through an authenticated RPC. The RPC locks the category, re-counts products inside the database transaction and deletes only when the count remains zero.
- The products-to-categories foreign key uses `ON DELETE RESTRICT`; categories never cascade-delete, auto-delete or auto-move products.
- The customer category button row alone is sticky below the 70 px top navigation. The collection heading/result count scroll normally, while the button row remains horizontally touch-scrollable and keyboard accessible. Customer catalogue cards use a two-column grid at the mobile breakpoint without changing Owner Products.

### Visual theme

- PR #13 retires Dark Mode for Customer, Owner and Staff. The application is light-only and removes the customer theme control, toggle handlers and all dark-theme CSS overrides.
- Application startup removes the retired `yt-theme-v2` Local Storage value and any stale `body.dark-mode` class before rendering, so refresh/login cannot restore a dark interface.
- Final palette: primary pink `#D96C91`, accessible interactive pink `#B84F73`, strong hover pink `#9F3D61`, page `#FFF8FA`, surface `#FFFFFF`, soft surface `#FCEAF0`, border `#EED8E0`, text `#35252D`, muted `#74636B`.
- Normal-size white button text uses `#B84F73` (4.77:1 contrast) instead of `#D96C91` (3.23:1). `#D96C91` remains the requested decorative/default voucher accent. Error, warning and success colors remain semantic red, amber and green.
- Global keyboard focus uses a visible three-pixel pink focus ring. Inputs also receive an accessible border and focus halo; disabled controls remain visibly distinct.
- Voucher screen styling follows the light palette while the owner-selected voucher accent remains functional. Print output explicitly forces a white background and dark ink and retains the existing A4/A5 layout and confirmed-value contract.

### Database and Storage

Database တွင် `profiles`, `categories`, `products`, `orders`, `order_items`, `cart_items`, `inventory_movements`, `voucher_settings`, `app_settings`, updated-at triggers, constraints နှင့် RLS policies ရှိသည်။

- `product-images`: public, images only, 500 KB limit
- `delivery-proofs`: private, images only, 5 MB limit

## 4. Current data-source status

| Feature | Current source | Status |
|---|---|---|
| Owner authentication | Supabase Auth + `profiles` | Live |
| Password recovery | Supabase Auth email | Live; free email rate limits apply |
| Categories/products | Supabase PostgreSQL | Live |
| Product images | Supabase Storage | Live |
| Inventory movements | Supabase PostgreSQL | Live |
| Cart | Supabase `cart_items` through validated RPCs | Live since PR #10 |
| Orders/order items | Supabase transactional checkout RPC | Live since PR #10 |
| Customer/staff accounts | Supabase Auth + protected Edge Functions | Live; PR #11 expands active-staff customer operations |
| Voucher/settings/maintenance | Browser Local Storage | Migration required |
| Delivery proofs | Bucket exists | Private upload/access flow required |
| Backup/restore | Browser Local Storage | Not a production database backup |

## 5. Target account design

- Owner and customers log in with `username + password` in the UI.
- Customer/staff accounts are created and managed by an owner.
- Customer/staff cannot use public sign-up or email password recovery.
- Owner can reset a managed account's password.
- Owner keeps a real email identity for emergency recovery.

First-version decision:

- Username lookup/login uses a public Edge Function that returns a normal Supabase session after credential validation.
- Account list/create, enable/disable and owner-managed password reset use an authenticated owner-only Edge Function.
- The frontend calls these functions through `account-service.js`, keeping the backend contract in one replaceable service layer.
- Customer password-change and email-recovery controls are not shown. Only an owner can reset managed customer/staff passwords through the UI.
- For this test version, owner-managed customer/staff passwords accept any value of at least 6 characters. This is intentionally weaker than the recommended 12-character policy and must be reviewed before production launch.
- The primary owner keeps the existing real-email recovery flow.
- This test version does not attempt strict custom authentication that technically prevents a knowledgeable signed-in customer from calling Supabase's password-update API directly. That stronger control is deferred intentionally.
- Secret/service-role credentials remain only in Supabase Edge Function environment variables and never in frontend code or GitHub.

## 6. Security and consistency rules

- Never trust role, price, stock, order total or account ID sent by the frontend.
- Enforce authorization with RLS plus server-side checks.
- Product stock updates and matching inventory movements remain transaction-safe inventory operations, independent from ordering.
- Order creation, items, totals and cart clearing are one server/database transaction. Checkout does not reduce or allocate stock.
- Public order references use database-generated `YT-YYMMDD-NNNN` numbers based on the Asia/Yangon calendar date. Internal UUIDs remain database identifiers and are not shown to customers or owners.
- Owner order lists are database-filtered and paginated in stable `created_at, id` order. Status groups and debounced search never fetch the complete order table into the browser.
- Order status transitions are server-enforced and forward-only: Pending → Approved → Processing → Ready to Ship → Delivered. Customers cannot change status.
- Active staff share operational product, inventory, order, voucher and customer-account actions with the owner. Owner identity, owner/staff account management, Settings and project security controls remain owner-only.
- Staff authorization is enforced from the authenticated profile (`role in ('owner','staff')` and `is_active = true`) inside RLS, RPCs and the account-admin Edge Function; frontend visibility is not an authorization boundary.
- Category listing/deletion RPCs use the same active owner/staff server-side authorization. Anonymous, customers and disabled staff are denied; direct authenticated table deletion remains revoked.
- The primary owner and all owner/staff targets are protected from staff account actions server-side. Staff can list, create, reset and enable/disable customer accounts only and cannot create/promote staff or owner accounts.
- PR #10 database contract treats `order_items.quantity` as the immutable requested quantity. The legacy `allocated_quantity` column is retained only for migration compatibility and historical audit; new rows remain `0`, and application logic does not read or write it.
- Requested audit snapshots remain in `quantity`, `unit_price`, `line_total` and `orders.total`; owner-managed final values are stored separately in `confirmed_quantity`, `confirmed_unit_price`, `confirmed_line_total` and `orders.confirmed_total`.
- Customers see original requested values before `Ready to Ship`. At `Ready to Ship` and `Delivered`, Order Details and Voucher show final confirmed unit prices, line totals and grand total. Only a confirmed-quantity difference creates an adjustment notice; price changes never create a comparison/notification.
- Stock-independent ordering accepts shortages. Checkout and owner confirmation never validate against, reduce or allocate product stock and never create inventory movements, so an order cannot make stock negative. Owner inventory tools remain the source of stock changes.
- Cart writes and checkout use authenticated, active-customer RPCs. The browser-supplied customer ID, price, unit, minimum, product status and total are never accepted.
- Delivery proofs stay private; only the related customer and authorized owner/staff may access them.
- PR #14 replaces the legacy browser/data-URL proof with a private `delivery-proofs` Storage object plus one current `delivery_proofs` metadata row per order. Object paths use `orders/{order_uuid}/{random_uuid}.{mime-derived-extension}` and contain no customer name, filename or other PII.
- Active owner/staff can optionally upload while marking a Ready-to-Ship order Delivered, or upload/replace/remove on an existing Delivered order. The database rechecks the active manager role, order/status, exact path, allowed MIME and 5 MB limit; direct metadata writes are revoked.
- Customers can read metadata and create a short-lived signed URL only for their own order. Other customers, anonymous users and disabled staff are denied by both table RLS and exact-object Storage policies. Signed URLs are generated on demand for 120 seconds and are never persisted or logged.
- Failed metadata/status persistence triggers an exact-path cleanup of the new upload. Replacement swaps metadata first and then deletes only the previous exact object; a failed old-object cleanup preserves the new proof and surfaces a review warning.
- Voucher screen and A4/A5 print output never contain the private image, signed URL or Storage path. They show only `Delivery proof recorded` when metadata exists.
- Do not restore authentication, roles or passwords from browser backup JSON.
- Publishable key is public only with correct RLS/Storage policies; secret/service-role keys are never public.

## 7. Known issues and risks

- Supabase built-in email may return `EMAIL RATE LIMIT EXCEEDED`; production recovery needs custom SMTP.
- Managed-account migration `202608050001` and Edge Functions `username-login` / `account-admin` were deployed to the linked Supabase project on 2026-08-05. Owner username login, customer creation/login, owner-managed password reset, old-password denial, disable denial and re-enable login were manually validated against the deploy preview.
- Voucher settings and browser backup flows remain Local Storage features; cart and orders are retired as Local Storage sources of truth by PR #10.
- PR #11 fixes blank voucher printing by cloning the persisted-data voucher into a dedicated print root outside `#app`; the previous print stylesheet hid `#app` and therefore hid the voucher modal itself. Font/image readiness and `beforeprint`/`afterprint` cleanup keep print and cancel flows stable.
- Voucher printing supports explicit A4 (10 mm margins) and A5 (7 mm margins), repeating table headers, non-splitting rows/totals and long-name wrapping. Screen and print use the same requested/confirmed display helpers and public order number.
- Customer catalogue photos use a card-specific 4:3 responsive wrapper and final `object-fit: contain; object-position: center` without changing owner thumbnails.
- Legacy `yt-cart-v3` data is imported once after login only when product IDs are valid, products are active and quantities satisfy current database minimums; the key is then removed.
- Owner order confirmation changes only confirmed quantity and confirmed unit price; confirmed quantity is not constrained by available stock.
- README and UI must remain free of usable demo passwords.
- Browser JSON export is not a production database backup.
- A purchased custom domain is normally not free; use the Netlify free subdomain until purchasing one.
- PR #9 was re-scoped to a two-phase pre-production demo-data audit, backup and reset. After explicit confirmation, Phase 2 completed on 2026-08-05: 22 products, eight categories, one managed test customer/Auth user and six exact product images were removed. The primary owner and settings were preserved.
- The Phase 1 safety snapshot is stored locally under `.codex-tmp/pr9-phase1-20260805` and is excluded from Git. It contains JSON data, schema metadata and a Storage manifest; treat it as sensitive. It is not a directly restorable `pg_dump`, and Storage image bytes are not included.
- Free Plan does not provide downloadable/automatic database backups or PITR. A separate Storage object backup is required because database backups include metadata, not object bytes.

## 8. Required workflow

1. Start from an up-to-date clean `main` branch.
2. Create a focused feature branch; never edit `main` directly.
3. Check frontend, backend/data and maintenance/security impact together.
4. Validate relevant login, permission, CRUD, Storage and deployment flows.
5. Commit only related files and open a draft pull request.
6. Review changes and test results before merge.
7. Update this summary when architecture, data ownership, security or deployment changes materially.

## 9. Recommended next milestones

1. Validate and merge PR #14 private delivery-proof Storage flow after Deploy Preview authorization tests.
2. Confirm production remains on the merged PR #13 light-only build until PR #14 receives explicit approval.
3. Move remaining voucher/settings and backup behavior away from browser-only state where appropriate.
4. Add browser/mobile regression checks and a production-grade database plus Storage backup procedure.

## 10. Validation checklist

- Owner: login, logout, recovery, role denial and inactive-account denial
- Accounts: create, disable, owner reset and unauthorized access denial
- Products: list, add, edit, deactivate, image validation and upload failure
- Inventory: stock in/out, insufficient stock and movement consistency
- Orders: create, totals, stock-independent confirmation, status permissions and duplicate submission
- Storage: public product images; private delivery proofs and access denial
- UI: mobile layout, Myanmar text, keyboard navigation, loading/error/success states
- Deployment: Netlify live URL, Supabase allowed redirects and no repository secrets

## 11. Change log

- 2026-08-04: Initial static prototype imported.
- 2026-08-04: Secure Supabase owner authentication merged in PR #1.
- 2026-08-04: Catalogue and inventory migration merged in PR #2.
- 2026-08-04: Secure password recovery merged in PR #3.
- 2026-08-04: Added this shared project summary and documented remaining migrations and risks.
- 2026-08-05: Chose first-version username login with owner-managed customer/staff passwords, Edge Functions and a replaceable frontend account service layer.
- 2026-08-05: Applied managed-account RLS migration and deployed both Edge Functions; anonymous login failure and unauthenticated admin denial were verified.
- 2026-08-05: Completed owner/customer credential, reset and enable/disable end-to-end validation on Netlify deploy preview #5.
- 2026-08-05: Merged PR #6 after product CRUD, image input, category autocomplete, database constraints and mobile layout validation.
- 2026-08-05: Drafted PR #7 template-based Product Excel export; Unit is appended after Stock, local spreadsheet/runtime samples passed, and deploy-preview empty/success/filter/mobile flows were validated.
- 2026-08-05: PR #7 was merged. Started PR #8 catalogue performance: 20-row database pagination, database category/search filters, stable ordering, lazy images, complete loading/error/empty/count states, catalogue indexes and protected category-wide price adjustment. Cart/orders remains scheduled for PR #9 after PR #8 approval.
- 2026-08-05: PR #8 merged. PR #9 Phase 1 completed a read-only pre-production audit and local safety snapshot: 22 products, eight categories, one test customer and six product-image objects are proposed for cleanup; owner Auth/profile, schema, policies, functions, settings and project configuration remain protected. No live cleanup has run.
- 2026-08-05: After explicit confirmation, PR #9 Phase 2 removed the exact audited demo records and Storage objects. Post-cleanup counts are zero for products, categories, inventory, orders, order items, carts and both Storage buckets; only the active primary owner remains, and voucher/app settings remain unchanged. Browser-local demo seed data and legacy commerce keys were retired.
- 2026-08-07: PR #9 merged as `0bb2752`. PR #10 started on `codex/supabase-cart-transactional-orders`: account-scoped Supabase cart RPCs, idempotent transactional checkout, requested-versus-allocated quantities, shortage-safe stock updates, transactional owner allocation, stricter active-account RLS, one-time stale cart normalization, and accessible photo preview updates were implemented. Local and deploy-preview validation remain before merge.
- 2026-08-07: PR #10 order confirmation was corrected to preserve separate requested and confirmed quantity/price audit fields. Customer quantity notices compare only requested versus confirmed quantity; final payable prices and totals appear from Ready to Ship onward without price-change notifications.
- 2026-08-07: PR #10 retired the stock-allocation concept. Owner confirmation now edits only confirmed quantity and unit price without stock limits; checkout/confirmation do not mutate stock or inventory movements. The legacy allocation column remains unused for compatibility.
- 2026-08-07: Fixed Ready-to-Ship status normalization so customer Order Details and Voucher use persisted confirmed quantities, unit prices, line totals and grand total. Numeric mapping uses explicit null handling so a confirmed price of `0` remains valid.
- 2026-08-07: Product Edit now sends all product fields and the desired absolute stock to an active-owner-only atomic RPC. The database locks the row, rejects stale edits, calculates the stock difference from its current value and writes a matching IN/OUT movement only when stock changed. The separate Products-page Adjust Stock action was retired.
- 2026-08-07: Order list counts and totals now use the same status-aware confirmed-value helpers as details and vouchers. Ready-to-Ship/Delivered list, screen voucher and print output use confirmed quantities, prices, line totals and total; pending states and confirmed-null legacy rows safely use requested values.
- 2026-08-07: PR #10 added short public order numbers with deterministic legacy backfill, atomic Yangon-date daily sequencing, server-enforced forward status transitions, and database-side Owner Orders status/search filtering with 20-row stable pagination and supporting indexes. Production deployment remains blocked pending approval.
- 2026-08-08: PR #10 merged as `990c3af`; GitHub deployment and Cloudflare build checks completed successfully.
- 2026-08-08: PR #11 production stabilization fixed the voucher blank-print root cause with a dedicated print document, added verified A4/A5 multi-page layouts, retained status-aware confirmed totals and image containment, and introduced active-staff operational permissions with server-side primary-owner protection. Migration `202608080001` and the updated account-admin Edge Function were deployed to the linked Supabase project; DB lint and anonymous denial passed. Deploy Preview role/manual tests remain before merge.
- 2026-08-09: Verified PR #11 merged as `4f9fe7b` with successful production deployment checks. Started PR #12 on `codex/pr12-category-management`: active owner/staff category management, database-counted safe deletion with row locking and restrictive FK behavior, and a customer-only sticky horizontal category bar. Automated/local validation and Deploy Preview manual tests remain before merge.
- 2026-08-09: PR #12 migrations `202608090001` and `202608090002` were applied to the linked Supabase project after a successful dry-run. Remote DB lint is clean, remote migration state is current, and anonymous list/delete RPC calls return `401`. Local desktop/mobile computed-style checks confirm the category row sticks at 70 px below navigation, scrolls horizontally on mobile and remains below menus/modals. Deploy Preview still needs active-owner, active-staff, disabled-staff, product-dependent deletion and catalogue regression testing before merge.
- 2026-08-10: Verified PR #12 merged as `05c8362` with successful build/deploy/Workers checks. Started PR #13 on `codex/pr13-soft-pink-theme`: soft-pink light-only palette, complete Dark Mode UI/CSS/JavaScript retirement, safe stale-theme Local Storage cleanup, accessible interactive contrast/focus decisions and print-safe voucher overrides. Local visual/regression validation and Deploy Preview manual tests remain before merge.
- 2026-08-10: Verified PR #13 merged as `3d23edb`. PR #14 migration `202608100001` was dry-run, linted clean and applied to the linked project. It adds private Storage enforcement, one-current-proof metadata/RLS, server-authorized upload/replace/remove RPCs, exact-path cleanup, short-lived authorized viewing, an accessible mobile lightbox and print-safe recorded-only voucher output. Anonymous metadata/RPC requests return `401`; active owner/staff/customer cross-account and failure-path tests remain for Deploy Preview before merge.
