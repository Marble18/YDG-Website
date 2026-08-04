# YDG Ecommerce — Project Summary

ဒီဖိုင်ကို Frontend, Backend/Data နှင့် Bug/Maintenance အလုပ်အားလုံးအတွက် shared source of truth အဖြစ် သုံးပါမည်။ ကြီးမားသော feature သို့မဟုတ် architecture ပြောင်းလဲမှု merge ပြီးတိုင်း update လုပ်ရပါမည်။

Last updated: 2026-08-04

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

This is not complete yet. Supabase Auth uses email/phone identities internally, so username login must be implemented through trusted server-side code such as Supabase Edge Functions. Account creation, username lookup and owner password reset must never use a secret/service-role key in the browser.

Before implementation, decide whether “customers cannot change passwords” means only hiding that UI, or technically prohibiting every self-change attempt. The strict version requires a server-controlled auth design and additional security work.

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
- Username/password owner-managed accounts and Edge Functions are not implemented yet.
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

1. Design and implement secure username account APIs/Edge Functions.
2. Move customer profiles and owner-managed account UI fully to Supabase.
3. Move cart and order submission to database transactions/RPC.
4. Complete owner order management and private delivery-proof flow.
5. Move voucher, app settings and maintenance mode to Supabase.
6. Add browser/mobile regression checks and production backup procedure.

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
