# Yadanar Theingi Stationery & Fancy — Ordering System Demo

This is an interactive front-end prototype for the planned customer ordering and owner inventory system.

## Open the demo

Open index.html in a modern browser.

Demo accounts:

- Owner: owner / Owner123
- Customer: mya / Mya123

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

The demo deliberately stores its data only in the current browser using local storage. It is suitable for reviewing the screen design and workflow, but it is **not yet a live multi-user website**.

For the production version, add:

1. A secure backend and database for shared orders, products, customers and inventory.
2. Password hashing, secure owner authentication and proper access permissions.
3. Automated backups and deployment to cloud hosting with a custom domain.
4. Server-run backup scheduling, delivery notifications and payment integrations as needed.

The production site can keep the same customer and owner workflows shown in this demo.
