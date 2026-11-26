# Rent & Electric Bill Tracker (PWA)

> **Live App:** https://rent-tracker-qxt9.onrender.com/ *(or double-click `Open Rent Tracker.url` in this folder)*

A manual-first **Rent, Electric Bill, and Security Deposit Tracker** built as an installable **Progressive Web App (PWA)** in **Indian Rupees (`INR ₹`)**.

## Features

- **Security Deposit Tracking:** Record the security deposit held at the start of the renting period and settle/return it (full or partial with deduction preview) when the renting period ends.
- **Monthly Columns & Month Tabs:** Track every month's **Rent** and **Electric Bill** in a tabular column overview or focused per-month tabs.
- **Settings & Top-of-Page Rent Rate:** Enter or update the monthly rent anytime — automatically updates all **`Due / Pending`** months while locking already **`Paid / Success`** months at their historical paid rent.
- **Manual Electric Bill Entry:** Electric bill fields start blank each month; entering an amount automatically shows **`Due / Pending`** on the side, which manually toggles to **`Paid / Success`** when clicked upon receiving payment.
- **Installable & Offline-Ready PWA:** Workbox service worker, `manifest.webmanifest`, PNG app icons, IndexedDB state cache, and automatic offline queue sync (`client_mutation_id`).
- **CSV & JSON Exports:** One-click export of monthly ledger and security deposit records.

## Tech Stack

- **Backend:** Python 3.13 (`FastAPI`, `SQLAlchemy 2`, `SQLite`, `uvicorn`)
- **Frontend PWA:** React 19, TypeScript, Vite, Tailwind CSS v4, `vite-plugin-pwa` (Workbox)

## Local Development

### 1. Backend (Python 3.13 `.venv`)
```powershell
cd backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

### 2. Frontend Dev Server (Optional for UI hot reload)
```powershell
cd frontend
npm run dev
```

### 3. Single-Server Production Preview (Built PWA + API)
```powershell
cd frontend
npm run build
cd ..\backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```
Open `http://127.0.0.1:8000` in Chrome or Edge.

## Running Tests
```powershell
cd backend
..\.venv\Scripts\python.exe -m pytest -v
```
