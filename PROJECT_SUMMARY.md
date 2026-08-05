# YDG Ecommerce — Project Summary

ဒီဖိုင်ကို Frontend, Backend/Data နှင့် Bug/Maintenance အလုပ်အားလုံးအတွက် shared source of truth အဖြစ် သုံးပါမည်။ ကြီးမားသော feature သို့မဟုတ် architecture ပြောင်းလဲမှု merge ပြီးတိုင်း update လုပ်ရပါမည်။

Last updated: 2026-08-05

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
| Cart | Browser Local Storage | Migration required |
| Orders/order items | Mainly browser state | Migration required before real customers |
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
- Product stock update and inventory movement insert must become one database transaction/RPC. They are currently separate client requests and can become inconsistent.
- Order creation, items, totals and stock reduction must be one server/database transaction.
- Delivery proofs stay private; only the related customer and authorized owner/staff may access them.
- Do not restore authentication, roles or passwords from browser backup JSON.
- Publishable key is public only with correct RLS/Storage policies; secret/service-role keys are never public.

## 7. Known issues and risks

- Supabase built-in email may return `EMAIL RATE LIMIT EXCEEDED`; production recovery needs custom SMTP.
- Managed-account migration `202608050001` and Edge Functions `username-login` / `account-admin` were deployed to the linked Supabase project on 2026-08-05. Owner username login, customer creation/login, owner-managed password reset, old-password denial, disable denial and re-enable login were manually validated against the deploy preview.
- Orders, customers, cart, voucher settings and backup flows are not fully migrated from Local Storage.
- Inventory writes are not yet transactional.
- README and UI must remain free of usable demo passwords.
- Browser JSON export is not a production database backup.
- A purchased custom domain is normally not free; use the Netlify free subdomain until purchasing one.

## 8. Required workflow

1. Start from an up-to-date clean `main` branch.
2. Create a focused feature branch; never edit `main` directly.
3. Check frontend, backend/data and maintenance/security impact together.
4. Validate relevant login, permission, CRUD, Storage and deployment flows.
5. Commit only related files and open a draft pull request.
6. Review changes and test results before merge.
7. Update this summary when architecture, data ownership, security or deployment changes materially.

## 9. Recommended next milestones

1. Move cart and order submission to database transactions/RPC.
2. Complete owner order management and private delivery-proof flow.
3. Move voucher, app settings and maintenance mode to Supabase.
4. Add browser/mobile regression checks and production backup procedure.

## 10. Validation checklist

- Owner: login, logout, recovery, role denial and inactive-account denial
- Accounts: create, disable, owner reset and unauthorized access denial
- Products: list, add, edit, deactivate, image validation and upload failure
- Inventory: stock in/out, insufficient stock and movement consistency
- Orders: create, totals, stock reduction, status permissions and duplicate submission
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
- 2026-08-05: Started PR #7 template-based Product Excel export; the requested Unit column is appended after Stock while minimum quantity remains outside the supplied export format.
