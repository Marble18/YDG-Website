# YDG Ecommerce — Project Summary

ဒီဖိုင်ကို Frontend, Backend/Data နှင့် Bug/Maintenance အလုပ်အားလုံးအတွက် shared source of truth အဖြစ် သုံးပါမည်။ ကြီးမားသော feature သို့မဟုတ် architecture ပြောင်းလဲမှု merge ပြီးတိုင်း update လုပ်ရပါမည်။

Last updated: 2026-08-07

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
| Cart | Supabase `cart_items` through validated RPCs | PR #10 implementation; preview validation required |
| Orders/order items | Supabase transactional checkout RPC | PR #10 implementation; preview validation required |
| Customer/staff accounts | Legacy/browser UI is incomplete | Secure server-side flow required |
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
- PR #10 database contract treats `order_items.quantity` as the immutable requested quantity. The legacy `allocated_quantity` column is retained only for migration compatibility and historical audit; new rows remain `0`, and application logic does not read or write it.
- Requested audit snapshots remain in `quantity`, `unit_price`, `line_total` and `orders.total`; owner-managed final values are stored separately in `confirmed_quantity`, `confirmed_unit_price`, `confirmed_line_total` and `orders.confirmed_total`.
- Customers see original requested values before `Ready to Ship`. At `Ready to Ship` and `Delivered`, Order Details and Voucher show final confirmed unit prices, line totals and grand total. Only a confirmed-quantity difference creates an adjustment notice; price changes never create a comparison/notification.
- Stock-independent ordering accepts shortages. Checkout and owner confirmation never validate against, reduce or allocate product stock and never create inventory movements, so an order cannot make stock negative. Owner inventory tools remain the source of stock changes.
- Cart writes and checkout use authenticated, active-customer RPCs. The browser-supplied customer ID, price, unit, minimum, product status and total are never accepted.
- Delivery proofs stay private; only the related customer and authorized owner/staff may access them.
- Do not restore authentication, roles or passwords from browser backup JSON.
- Publishable key is public only with correct RLS/Storage policies; secret/service-role keys are never public.

## 7. Known issues and risks

- Supabase built-in email may return `EMAIL RATE LIMIT EXCEEDED`; production recovery needs custom SMTP.
- Managed-account migration `202608050001` and Edge Functions `username-login` / `account-admin` were deployed to the linked Supabase project on 2026-08-05. Owner username login, customer creation/login, owner-managed password reset, old-password denial, disable denial and re-enable login were manually validated against the deploy preview.
- Voucher settings and browser backup flows remain Local Storage features; cart and orders are retired as Local Storage sources of truth by PR #10.
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

1. Validate and merge PR #10 Supabase cart, transactional ordering and stock-independent confirmation.
2. Complete private delivery-proof Storage flow.
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
