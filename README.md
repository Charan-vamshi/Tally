# Dattareya Enterprises — Billing, Inventory & Khata System

A modern, fast, Tally-inspired web billing application tailored for fertilizer & pesticide retail/wholesale counters.

## Features
- **Tab 1: Billing Counter (F2):** Fast product addition, customer/farmer selector, live GST breakdown (CGST/SGST), payment mode (Cash/UPI/Udhar), and A4 USB printable Tally-style bill.
- **Tab 2: Stock & Inventory (F3):** Real-time stock levels, low-stock warnings, bags & liquid units, instant stock adjustments.
- **Tab 3: Khata / Udhar (F4):** Farmer credit ledger, outstanding receivables, record payment receipts.
- **Tab 4: Reports & Tax (F5):** Daily sales summary, 5% vs 18% GST registers, 1-click Export to Excel (CSV).

## First Commit & Deployment to Koyeb
1. Commit the files:
   ```bash
   git add .
   git commit -m "Initial commit: Dattareya billing demo with 4 smooth dashboard tabs"
   ```
2. Create a new repository on your GitHub account (e.g. `dattareya-billing`).
3. Link and push your code:
   ```bash
   git remote add origin https://github.com/<your-username>/dattareya-billing.git
   git branch -M main
   git push -u origin main
   ```
4. On **Koyeb.com**:
   - Click **Create Service** -> **GitHub**.
   - Select your `dattareya-billing` repo.
   - Koyeb will automatically detect the Dockerfile/Node configuration, expose port 8000, and deploy your live URL in 60 seconds!
