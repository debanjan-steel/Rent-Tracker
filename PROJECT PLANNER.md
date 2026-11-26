# Rent Tracking Progressive Web App (PWA) — Dynamic Project Planner

> **Living Document:** Updated continuously as requirements and decisions evolve.  
> **Last Updated:** `2026-11-26`  
> **Workspace Runtime:** Python 3.13.14 (`.venv` auto-activated via `.vscode/settings.json` & `.python-version`)  
> **Target Platform:** Installable Progressive Web App (Desktop, Android, iOS Home Screen)  
> **Live Deployed App:** https://rent-tracker-qxt9.onrender.com/ *(1-tap shortcut: `Open Rent Tracker.url`)*  
> **Entry Mode:** **100% Manual Entry** (no background billing automation or external bank/meter scraping)

---

## Status Icon Tabs

> **Legend:** `✅ Done` Completed | `🔄 Ongoing` Currently In Progress | `🗓️ Future` Upcoming / Planned | `⏭️ Descoped` Removed per Manual-First Scope

### Tab 1: ✅ Done
| Task | Category | Notes |
| :--- | :--- | :--- |
| ✅ Initialize Python 3.13.14 virtual environment (`.venv`) | Environment | Verified `.venv\Scripts\python.exe` (`Python 3.13.14`) |
| ✅ Configure IDE & terminal auto-activation | Environment | Created `.vscode/settings.json`, `.python-version`, `.gitignore` |
| ✅ Create living `PROJECT PLANNER.md` | Planning | Established dynamic planner with icon tabs & decision log |
| ✅ Capture core v1 functional requirements | Product Spec | Security deposit, monthly rent + electric bill columns/tabs, Settings/top-bar rent, manual entry |
| ✅ Lock rent update & payment toggle rules | Product Spec | Rent auto-fills `Due / Pending` months; tap toggles to `Paid / Success`; rent edits update only `Due / Pending` months (`Paid / Success` stays locked) |
| ✅ Lock scope, Option A stack, INR (`₹`), & Electric Bill UX | Phase 0 | Single tenant now (multi-tenant-ready schema), FastAPI + React/Vite TypeScript PWA, `INR ₹`, blank electric input -> `Due / Pending` -> `Paid / Success` |
| ✅ Scaffold backend (`pyproject.toml`, FastAPI, SQLite/SQLAlchemy) | Phase 1 | Installed dependencies in `.venv` (`backend/requirements.txt`) |
| ✅ Implement data models & status-based rent update logic | Phase 1 | `AppSettings`, `RentRateHistory`, `LeasePeriod`, `MonthlyEntry` (`INR` paise minor units) |
| ✅ Build REST API + unit tests (`pytest`) | Phase 1 | Verified all API flows including deposit, blank->due->paid electric, rent lock, & idempotency |
| ✅ Build mobile-first PWA shell (`manifest.webmanifest` + Service Worker) | Phase 2 | Built via `vite-plugin-pwa` (Workbox precache, PNG icons, `/api/` nav denylist, MIME/cache headers) |
| ✅ Build Security Deposit card, Month Columns/Tabs & Settings UI | Phase 2 | Implemented `RentRateBanner`, `ElectricCell`, `MonthlyLedgerView`, `SecurityDepositPanel`, `SettingsPanel` |
| ✅ Add IndexedDB offline queue & JSON/CSV backup export | Phase 3 | Implemented `offlineStore.ts` + offline sync replay + `/api/v1/export/csv` & JSON backup |
| ✅ Add container & deployment files + live server verification | Phase 4 | Added `Dockerfile`, `.dockerignore`, `render.yaml`, `README.md`; verified live `uvicorn` PWA + API smoke test |
| ✅ Push project to GitHub (`debanjan-steel/Rent-Tracker`) | Release | Pushed clean `main` branch with Python, React PWA, tests, and Docker configs |

### Tab 2: 🔄 Ongoing
| Task | Category | Notes |
| :--- | :--- | :--- |
| 🔄 Deploy over HTTPS & install PWA on devices | Release | Follow deployment instructions (Fly.io / Railway / Render) to get an `https://` URL |

### Tab 3: 🗓️ Future
| Task | Category | Notes |
| :--- | :--- | :--- |
| 🗓️ Run Lighthouse PWA audit & mobile Home Screen install test | Phase 4 | Verify standalone install prompt on Android/iOS/Desktop after HTTPS deploy |
| 🗓️ Multi-tenant switcher UI (v2 expansion) | Future v2 | Add tenant selector when moving from single tenant to multiple tenants |

---

## 1. Confirmed Core Feature Specifications

All entries and status changes in the app are **manually operated** by the user — no automated invoicing bots, bank feeds, or smart-meter integrations.

### 1.1 Security Deposit Tracker (Start -> End of Renting Period)
- Dedicated **Security Deposit** section linked to the renting period / lease.
- **Start of Renting Period:**
  - Enter the initial **Security Deposit Amount** given, date given, and optional payment mode/notes.
  - Displays deposit status badge: `⏳ Held`.
- **End of Renting Period:**
  - When the renting period ends, trigger **Settle / Return Deposit**:
    - Record amount returned (full deposit, or optional manual adjustment/deduction note if any).
    - Record return date and update status badge to `✅ Returned`.
  - Keep a clear visual summary showing **Deposit Held** vs. **Deposit Returned**.

### 1.2 Monthly Ledger Columns & Month Tabs (Two Values: Rent + Electric Bill)
- Every month explicitly contains **two tracked values**: **Rent** and **Electric Bill**.
- **Monthly Ledger Table / Grid View:**
  - Displays every month with dedicated columns for:
    1. **Month** (e.g., `Nov 2026`, `Dec 2026`)
    2. **Rent** (auto-filled amount + tappable status badge)
    3. **Electric Bill** (manually entered amount + tappable status badge)
    4. **Monthly Total** (`Rent + Electric Bill`) & settled summary
- **Per-Month Tab / Detail View:**
  - Quick navigation tabs/cards per month so on mobile you can jump straight into any month (`Jan`, `Feb`, ..., or `YYYY-MM`), inspect/edit the Electric Bill, and tap to mark Rent or Electric Bill as paid.

### 1.3 Settings / Top-of-Page Rent Rate (Updates `Due / Pending` Months Only)
- Provide an editable **Monthly Rent Amount** control inside **App Settings** and/or pinned at the **top of the main page** for quick updates anytime.
- **Auto-Fill with `Due / Pending` Status:**
  - Every month automatically pre-fills its **Rent** value from this configured rate with a **`🟠 Due / Pending`** badge shown to the side.
- **Confirmed Update Rule (`Due / Pending` vs. `Paid / Success`):**
  - When the rent amount is changed at the top of the page or in Settings, it **automatically updates the rent amount of all months currently in `🟠 Due / Pending` status** (i.e., from the due month onward).
  - **Immutable Paid History:** Any month already marked **`🟢 Paid / Success`** **never changes** — preserving the exact historical rent amount that was actually paid.

### 1.4 Manual Tap-to-Pay Status Toggles (`Due / Pending` -> `Paid / Success`)
- **Rent Status Toggle:** When a month's rent is paid, manually tap the **`🟠 Due / Pending`** badge/button beside that month's rent to change it to **`🟢 Paid / Success`**.
- **Electric Bill Entry & Status Toggle (Confirmed 3-Step Flow):**
  1. **Starts Blank:** Inside each month's tab (and table cell), the electric bill field starts **blank/empty** until the month's bill arrives.
  2. **Auto-Shows `Due / Pending` on Entry:** As soon as the user manually enters the electric bill amount, the right side displays **`🟠 Due / Pending`** (matching the Rent badge for unpaid months).
  3. **Manual Click to `Paid / Success`:** Upon receiving the money, the user manually clicks/taps the **`🟠 Due / Pending`** button to change it to **`🟢 Paid / Success`**.
- *(Safety UX: Support an intentional undo/confirm option if a user accidentally taps `Paid / Success` on the wrong month.)*

### 1.5 Manual-First Simplicity (No Automation)
- **Manual Actions Only:**
  - Adding/opening a month, entering the electric bill amount, marking rent/electric as `Paid / Success`, and marking the security deposit as `Returned` are all manual user actions.
  - `⏭️ Descoped`: Automated monthly cron billing, bank/UPI auto-detection, automated late-fee penalties, and automated utility fetching are intentionally excluded to keep the app simple, predictable, and 100% under your control.

---

## 2. Progressive Web App (PWA) Capabilities

- **Installability (`manifest.webmanifest`)**
  - Standalone app launch (`display: "standalone"`), custom icons (`192x192`, `512x512`, maskable, and iOS `apple-touch-icon`), theme colors.
- **Offline Support (Service Worker + IndexedDB)**
  - App shell precaching so the app opens instantly even offline.
  - Local IndexedDB cache so you can view past months, deposit details, and log electric bills or mark items paid while offline; syncs safely when back online via unique `client_mutation_id` keys.
- **Mobile-First UX**
  - Responsive layout: table/grid columns on desktop/tablet, clean month tabs + stacked cards on phone screens, large touch targets (`>= 44x44px`), and dark/light theme support.
- **Data Portability**
  - One-click **CSV / JSON Export** for monthly rent + electric bill + security deposit records.

---

## 3. Selected Technical Architecture (`✅ Option A Confirmed`)

- **Scope:** **Single-Tenant MVP** right now, backed by a **multi-tenant-ready relational schema** (`LeasePeriod` / `tenant_name` separation) so expanding to multiple tenants/units later requires zero rewrite.
- **Currency:** **Indian Rupees (`INR ₹`)**, formatted with `en-IN` grouping (`₹12,500`) and stored cleanly in integer minor units (paise).
- **Backend (`backend/`)**: **FastAPI** (Python 3.13) + **SQLModel / SQLAlchemy 2.0 + Alembic** + **SQLite** + **`pytest`**.
- **Frontend (`frontend/`)**: **React + TypeScript + Vite** + **Tailwind CSS** + **`vite-plugin-pwa`** (Workbox) + **Dexie.js** (IndexedDB).

---

## 4. Simplified Data Model & Integrity Rules

> **Financial Rule:** Store all monetary values as **integer minor units** (e.g., paise/cents in `amount_minor`) or fixed `DECIMAL(12, 2)` — never floating-point numbers (`float`).

### Core Entities

1. **`AppSettings`**
   - `id`, `currency` (e.g., `"INR"`, `"USD"`), `current_rent_minor`, `rent_due_day` (`1..28` or `"last_day"`), `updated_at`
2. **`RentRateHistory`** *(Powers forward-only rent edits without mutating history)*
   - `id`, `lease_id`, `rent_amount_minor`, `effective_from_month` (`YYYY-MM`), `created_at`
3. **`LeasePeriod`** *(Represents a renting period / tenancy)*
   - `id`, `label` (e.g., `"Apartment 2B"` or `"2026–2027 Lease"`), `start_month` (`YYYY-MM`), `end_month` (`YYYY-MM`, nullable while active), `status` (`active` | `ended`)
   - **Security Deposit fields:** `security_deposit_minor`, `deposit_given_date`, `deposit_status` (`held` | `returned` | `partially_returned`), `deposit_returned_minor`, `deposit_returned_date`, `deposit_notes`
4. **`MonthlyEntry`** *(One record per month — backs both the Monthly Columns & Month Tabs)*
   - `id`, `lease_id`, `month_key` (`YYYY-MM`), `client_mutation_id`
   - **Rent columns:** `rent_amount_minor`, `rent_status` (`due_pending` | `paid_success`), `rent_paid_date`
   - **Electric Bill columns:** `electric_amount_minor` *(nullable until entered)*, `electric_status` (`not_entered` | `due_pending` | `paid_success`), `electric_paid_date`
   - **Extras:** `notes`, `updated_at`

### Rent Update Logic (Confirmed Rule)
When the user updates **Rent** (in Settings or the top-of-page Rent Rate input) to `new_rent_minor`:
1. Save `current_rent_minor = new_rent_minor` in `AppSettings` and record an audit entry in `RentRateHistory` (with `effective_from_month` metadata).
2. Update `rent_amount_minor = new_rent_minor` on **all `MonthlyEntry` rows where `rent_status == 'due_pending'`**.
3. **Never modify** `rent_amount_minor` on any row where `rent_status == 'paid_success'` (locking previously paid rents permanently).
4. Any new months created/opened afterward automatically pre-fill `rent_amount_minor = current_rent_minor` with `rent_status = 'due_pending'`.

---

## 5. Phased Implementation Plan (Live Checklist)

### Phase 0: Environment & Discovery
- [x] `✅ Done` Create `.venv` with Python 3.13.14 and verify activation.
- [x] `✅ Done` Configure `.vscode/settings.json`, `.python-version`, `.gitignore`.
- [x] `✅ Done` Document manual-first features (Security Deposit, Monthly Rent/Electric Columns & Tabs, Settings Rent Rule).
- [x] `✅ Done` Lock rent update rule (`Due / Pending` months update automatically; `Paid / Success` months stay locked) and tap-to-pay status flow.
- [x] `✅ Done` Confirm single-tenant MVP (multi-tenant-ready schema), **Option A** (FastAPI + React/Vite TypeScript PWA), `INR ₹`, and blank-until-entered Electric Bill UX.

### Phase 1: Backend & Data Engine
- [x] `✅ Done` Scaffold `backend/pyproject.toml` and install FastAPI, SQLAlchemy, Pydantic, pytest in `.venv`.
- [x] `✅ Done` Implement `AppSettings`, `RentRateHistory`, `LeasePeriod`, and `MonthlyEntry` models + SQLite schema.
- [x] `✅ Done` Implement status-based rent update service (`Due / Pending` updates, `Paid / Success` locked) and security deposit settlement logic.
- [x] `✅ Done` Write `pytest` tests covering deposit return, blank->`Due / Pending`->`Paid / Success` electric transitions, and Settings rent updates.

### Phase 2: PWA Shell & Core UI
- [x] `✅ Done` Initialize PWA frontend with responsive mobile-first shell + `manifest.webmanifest` + PNG icons.
- [x] `✅ Done` Build **Security Deposit Card** (amount held at start + end-of-period return flow).
- [x] `✅ Done` Build **Monthly Overview Columns** (Month | Rent + Status | Electric Bill + Status | Total) & **Month Tabs** view.
- [x] `✅ Done` Build **Settings / Top-Bar Rent Control** for changing the monthly rent amount (auto-updates all `Due / Pending` months).
- [x] `✅ Done` Implement 1-tap `Due / Pending` -> `Paid / Success` toggles for both Rent and Electric Bill.

### Phase 3: Offline Support & Exports
- [x] `✅ Done` Configure Workbox Service Worker (`vite-plugin-pwa`) for app shell caching.
- [x] `✅ Done` Add IndexedDB offline cache + mutation queue (`client_mutation_id`) so entries work offline.
- [x] `✅ Done` Add CSV & JSON backup export.

### Phase 4: Audit, Polish & Deployment
- [x] `✅ Done` Harden PWA offline routing (`navigateFallbackDenylist`), `.webmanifest`/`sw.js` headers, and UI click/blur edge cases.
- [x] `✅ Done` Add `Dockerfile`, `.dockerignore`, `render.yaml`, and `README.md` with configurable DB path.
- [x] `✅ Done` Push project to GitHub repository (`https://github.com/debanjan-steel/Rent-Tracker`).
- [ ] `🔄 Ongoing` Deploy over HTTPS and install PWA on phone/desktop.
- [ ] `🗓️ Future` Verify live HTTPS install prompt & Lighthouse PWA score post-deploy.

---

## 6. Discussion & Plan Change Log

| Date | Update Summary | Status Impact |
| :--- | :--- | :--- |
| `2026-11-26` | Initialized Python 3.13.14 `.venv`, IDE auto-activation, and baseline PWA planner. | `✅ Done` |
| `2026-11-26` | Converted planner into a dynamic icon-tabbed tracker (`✅ Done`, `🔄 Ongoing`, `🗓️ Future`). Added 5 confirmed manual-first features: Security Deposit hold/return, Monthly Rent & Electric Bill columns/tabs, Settings rent updates, Electric Bill `Due / Pending` -> `Paid / Success` flow, and descoped automation. | `✅ Done` |
| `2026-11-26` | Clarified two-value monthly model (Rent + Electric Bill), Settings/top-of-page Rent input auto-filling months as `Due / Pending`, manual tap-to-toggle to `Paid / Success`, and exact update rule: changing Rent updates all `Due / Pending` months while keeping `Paid / Success` months untouched. | `✅ Done` |
| `2026-11-26` | Finalized Phase 0 decisions: Single-tenant MVP (multi-tenant-ready schema), Option A (FastAPI + React/Vite TypeScript PWA), `INR ₹`, and blank-until-entered Electric Bill flow (`blank` -> manual entry -> `Due / Pending` -> click -> `Paid / Success`). Transitioned Phase 1 to `🔄 Ongoing`. | `✅ Done` |
| `2026-11-26` | Completed Phases 1–3 implementation: built FastAPI + SQLite backend, pytest integration tests, React + TypeScript + Vite PWA (`vite-plugin-pwa`, IndexedDB offline queue, PNG icons), Columns & Month Tabs UI, Security Deposit hold/return flow, Top-bar/Settings Rent Rate control, and CSV/JSON exports. | `✅ Done` |
| `2026-11-26` | Hardened PWA Workbox routing & MIME headers, added deposit deduction preview, added `Dockerfile`, `.dockerignore`, `render.yaml`, and `README.md`, and prepared repository for GitHub push & HTTPS PWA deployment. | `✅ Done` |
| `2026-11-26` | Pushed entire project to `https://github.com/debanjan-steel/Rent-Tracker` (`main`). Ready for HTTPS PWA deployment. | `✅ Done` |
| `2026-11-26` | Updated initial month seeding to start from `Jan 2026` (`2026-01` through current month), defaulted Month Tabs view to `Jan 2026`, and added automatic month backfilling when setting an earlier Lease Start Month in Settings. | `✅ Done` |
| `2026-11-26` | Added non-destructive schema & input-format migration engine (`SchemaMeta`, `extra_data`, `migrations.py`, `POST /api/v1/import/json`), PostgreSQL (`psycopg`) support for permanent cloud persistence, browser IndexedDB durable recovery guard, Settings JSON restore button, and 1-tap `Open Rent Tracker.url` shortcut for `https://rent-tracker-qxt9.onrender.com/`. | `✅ Done` |

---

## 7. Multi-Tenant Expansion Notes (Future v2 Ready)

- Schema links `MonthlyEntry` and `RentRateHistory` via `lease_id` (`LeasePeriod` includes `tenant_name` / `unit_label`), so adding a tenant switcher and multiple active leases later requires only UI tabs/routing without breaking existing data.
