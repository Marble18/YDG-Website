# Yadanar Theingi Stationery & Fancy — Ordering System Demo

This repository is being migrated from an interactive front-end prototype to a Supabase-backed ecommerce system.

Current architecture, completed migrations, known risks and next milestones are recorded in [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md).

## Open the demo

Open index.html in a modern browser.

## Included functions

- Owner-created customer accounts with enable/disable access
- Customer product catalogue, cart and order submission
- Owner product-photo upload and preview
- Category-wide percentage price increases or reductions
- Automatic stock-out record and stock reduction when an order is placed
- Owner dashboard for orders, products, inventory in/out and customers
- Owner adjustment of confirmed order quantities, with stock and customer total updated
- Order status progression: Pending, Approved, Processing, Ready to Ship and Delivered
- Required proof-of-delivery photo before an owner marks a new order Delivered
- Customer voucher access and printing once an order is Ready to Ship
- Owner-customizable voucher title, colour and footer, with live preview
- Additional owner accounts for trusted staff
- Backup export, JSON restore and Daily / Weekly / Monthly backup preferences
- Under Maintenance mode that blocks customer login but keeps owner access available
- Required delivery address and optional bus-station name for out-of-town orders
- Prices in Myanmar Kyat (MMK)

## Important before launch

Authentication, products, categories, inventory and product images now use Supabase. Orders, carts, customer management and several settings still require migration from browser Local Storage before the system is ready for real customers.

For the production version, add:

1. A secure backend and database for shared orders, products, customers and inventory.
2. Password hashing, secure owner authentication and proper access permissions.
3. Automated backups and deployment to cloud hosting with a custom domain.
4. Server-run backup scheduling, delivery notifications and payment integrations as needed.

The production site can keep the same customer and owner workflows shown in this demo.
