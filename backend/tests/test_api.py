"""API integration tests for Rent, Electric Bill, and Security Deposit rules."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app import db
from app.main import app


@pytest.fixture()
def client(tmp_path):
    """Provide an isolated SQLite database per test function."""
    db_file = tmp_path / "test_rent_tracker.db"
    test_engine = db.create_db_engine(f"sqlite:///{db_file.as_posix()}")
    TestSession = sessionmaker(bind=test_engine, autoflush=False, autocommit=False, expire_on_commit=False)

    orig_engine = db.engine
    orig_session_local = db.SessionLocal
    db.engine = test_engine
    db.SessionLocal = TestSession

    def override_get_session():
        session = TestSession()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[db.get_session] = override_get_session
    db.init_db(test_engine)

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()
    test_engine.dispose()
    db.engine = orig_engine
    db.SessionLocal = orig_session_local


def test_initial_dashboard_and_blank_electric_bill(client: TestClient):
    """App initializes in INR starting from January of current year with blank electric bills."""
    resp = client.get("/api/v1/dashboard")
    assert resp.status_code == 200
    data = resp.json()

    assert data["settings"]["currency"] == "INR"
    assert data["settings"]["default_rent_paise"] == 0
    assert data["active_lease"]["deposit_status"] == "not_set"
    assert data["active_lease"]["start_month"].endswith("-01")
    assert len(data["months"]) >= 1
    assert data["months"][0]["month_key"] == data["active_lease"]["start_month"]

    first_month = data["months"][0]
    assert first_month["rent_status"] == "due_pending"
    assert first_month["electric_amount_paise"] is None
    assert first_month["electric_status"] == "blank"

    # Cannot mark a blank electric bill as paid before entering an amount
    toggle_resp = client.post(f"/api/v1/months/{first_month['id']}/electric/toggle")
    assert toggle_resp.status_code == 400


def test_rent_setting_updates_only_due_pending_months(client: TestClient):
    """Changing rent updates all due_pending months while keeping paid_success months unchanged."""
    dash = client.get("/api/v1/dashboard").json()
    lease_id = dash["active_lease"]["id"]
    initial_count = len(dash["months"])
    m1 = dash["months"][0]

    # Set initial rent to ₹10,000 (updates all existing due_pending months)
    r1 = client.put("/api/v1/settings/rent", json={"rent_amount_paise": 1_000_000, "note": "Initial rent"})
    assert r1.status_code == 200
    assert r1.json()["updated_due_months_count"] == initial_count

    # Add two more future months (auto-filled with ₹10,000 and due_pending)
    m_extra_1 = client.post(f"/api/v1/leases/{lease_id}/months", json={}).json()
    m_extra_2 = client.post(f"/api/v1/leases/{lease_id}/months", json={}).json()
    assert m_extra_1["rent_amount_paise"] == 1_000_000
    assert m_extra_2["rent_amount_paise"] == 1_000_000

    # Mark first month (Jan) rent as paid_success
    pay_m1 = client.post(f"/api/v1/months/{m1['id']}/rent/toggle", json={"paid_date": "2026-01-05"})
    assert pay_m1.status_code == 200
    assert pay_m1.json()["rent_status"] == "paid_success"

    # Increase rent to ₹12,500 in Settings
    r2 = client.put("/api/v1/settings/rent", json={"rent_amount_paise": 1_250_000, "note": "Annual revision"})
    assert r2.status_code == 200
    assert r2.json()["updated_due_months_count"] == initial_count + 1

    updated_dash = client.get("/api/v1/dashboard").json()
    months = updated_dash["months"]
    assert months[0]["rent_amount_paise"] == 1_000_000
    assert months[0]["rent_status"] == "paid_success"
    assert all(m["rent_amount_paise"] == 1_250_000 and m["rent_status"] == "due_pending" for m in months[1:])

    # Adding another month later picks up the new ₹12,500 rate
    m_later = client.post(f"/api/v1/leases/{lease_id}/months", json={}).json()
    assert m_later["rent_amount_paise"] == 1_250_000
    assert m_later["rent_status"] == "due_pending"


def test_backfill_earlier_start_month_adds_missing_months(client: TestClient):
    """Updating lease start_month to an earlier date fills missing months without duplicating existing ones."""
    dash = client.get("/api/v1/dashboard").json()
    lease_id = dash["active_lease"]["id"]
    before_count = len(dash["months"])

    resp = client.put(
        f"/api/v1/leases/{lease_id}",
        json={"start_month": "2025-11"},
    )
    assert resp.status_code == 200

    after_dash = client.get("/api/v1/dashboard").json()
    assert after_dash["months"][0]["month_key"] == "2025-11"
    assert after_dash["months"][1]["month_key"] == "2025-12"
    assert len(after_dash["months"]) == before_count + 2


def test_electric_bill_blank_to_due_to_paid_and_clear(client: TestClient):
    """Electric bill transitions: blank -> due_pending on entry -> paid_success on manual tap."""
    dash = client.get("/api/v1/dashboard").json()
    m1_id = dash["months"][0]["id"]

    # Enter ₹1,450 electric bill -> automatically becomes due_pending
    entered = client.patch(f"/api/v1/months/{m1_id}/electric", json={"electric_amount_paise": 145_000})
    assert entered.status_code == 200
    assert entered.json()["electric_amount_paise"] == 145_000
    assert entered.json()["electric_status"] == "due_pending"

    # Tap status button to mark paid_success (and verify idempotent target_status replay)
    paid = client.post(
        f"/api/v1/months/{m1_id}/electric/toggle",
        json={"target_status": "paid_success", "paid_date": "2026-11-10"},
    )
    assert paid.status_code == 200
    assert paid.json()["electric_status"] == "paid_success"
    assert paid.json()["electric_paid_date"] == "2026-11-10"

    replay = client.post(
        f"/api/v1/months/{m1_id}/electric/toggle",
        json={"target_status": "paid_success", "paid_date": "2026-11-10"},
    )
    assert replay.status_code == 200
    assert replay.json()["electric_status"] == "paid_success"

    # Clearing amount back to null returns it to blank
    cleared = client.patch(f"/api/v1/months/{m1_id}/electric", json={"electric_amount_paise": None})
    assert cleared.status_code == 200
    assert cleared.json()["electric_amount_paise"] is None
    assert cleared.json()["electric_status"] == "blank"


def test_security_deposit_hold_and_return_and_csv_export(client: TestClient):
    """Security deposit can be recorded at start, returned at end, and exported to CSV."""
    dash = client.get("/api/v1/dashboard").json()
    lease_id = dash["active_lease"]["id"]

    # Record ₹50,000 deposit given at start
    held = client.put(
        f"/api/v1/leases/{lease_id}/deposit",
        json={
            "security_deposit_paise": 5_000_000,
            "deposit_given_date": "2026-11-01",
            "deposit_notes": "Paid via UPI at move-in",
        },
    )
    assert held.status_code == 200
    assert held.json()["deposit_status"] == "held"
    assert held.json()["security_deposit_paise"] == 5_000_000

    # Return full ₹50,000 deposit when renting period ends
    returned = client.post(
        f"/api/v1/leases/{lease_id}/deposit/return",
        json={
            "deposit_returned_paise": 5_000_000,
            "deposit_returned_date": "2027-10-31",
            "end_month": "2027-10",
            "mark_lease_ended": True,
        },
    )
    assert returned.status_code == 200
    assert returned.json()["deposit_status"] == "returned"
    assert returned.json()["deposit_returned_paise"] == 5_000_000
    assert returned.json()["status"] == "ended"

    csv_resp = client.get(f"/api/v1/export/csv?lease_id={lease_id}")
    assert csv_resp.status_code == 200
    assert "Security Deposit Held (INR),50000.00" in csv_resp.text
    assert "Deposit Status,returned" in csv_resp.text


def test_idempotent_month_creation_and_duplicate_conflict(client: TestClient):
    """Adding duplicate month_key returns 409 unless same client_mutation_id is replayed."""
    dash = client.get("/api/v1/dashboard").json()
    lease_id = dash["active_lease"]["id"]

    r1 = client.post(
        f"/api/v1/leases/{lease_id}/months",
        json={"month_key": "2027-01", "client_mutation_id": "mut-jan-2027"},
    )
    assert r1.status_code == 201

    replay = client.post(
        f"/api/v1/leases/{lease_id}/months",
        json={"month_key": "2027-01", "client_mutation_id": "mut-jan-2027"},
    )
    assert replay.status_code == 201
    assert replay.json()["id"] == r1.json()["id"]

    conflict = client.post(
        f"/api/v1/leases/{lease_id}/months",
        json={"month_key": "2027-01"},
    )
    assert conflict.status_code == 409


def test_pwa_static_and_api_404_guard(client: TestClient):
    """Built PWA index, manifest, and service worker are served and /api/* 404s stay JSON."""
    health_get = client.get("/api/v1/health")
    assert health_get.status_code == 200
    health_head = client.head("/api/v1/health")
    assert health_head.status_code == 200

    index_resp = client.get("/")
    assert index_resp.status_code == 200
    assert "Rent &amp; Electric Tracker" in index_resp.text

    manifest_resp = client.get("/manifest.webmanifest")
    assert manifest_resp.status_code == 200
    assert manifest_resp.headers["content-type"].startswith("application/manifest+json")
    assert "RentTracker" in manifest_resp.text

    sw_resp = client.get("/sw.js")
    assert sw_resp.status_code == 200
    assert sw_resp.headers.get("cache-control") == "no-cache"

    api_missing = client.get("/api/v1/does-not-exist")
    assert api_missing.status_code == 404


def test_import_migrates_changed_legacy_formats_without_data_loss(client: TestClient):
    """Legacy/changed formats (rupee strings, month names, DD/MM/YYYY dates, synonyms, extra fields) convert safely."""
    legacy_payload = {
        "settings": {"currency": "INR", "monthly_rent": "₹14,500"},
        "lease": {
            "tenant_name": "Arjun",
            "unit_label": "Flat 3A",
            "start_month": "Jan 2026",
            "security_deposit": "50000",
            "deposit_given_date": "01/01/2026",
            "custom_legacy_tag": "vip-tenant",
        },
        "months": [
            {
                "month": "Jan 2026",
                "rent": "14,500",
                "rent_paid": "paid",
                "rent_paid_date": "05/01/2026",
                "electric_bill": "1,234.50",
                "electric_paid": "success",
                "electric_paid_date": "10-01-2026",
                "meter_units": 182,
            },
            {
                "month": "2026/02",
                "rent": 14500,
                "rent_status": "pending",
                "electric": None,
            },
        ],
    }

    resp = client.post("/api/v1/import/json", json=legacy_payload)
    assert resp.status_code == 200
    data = resp.json()

    assert data["schema_version"] == 2
    assert data["settings"]["default_rent_paise"] == 1_450_000
    assert data["active_lease"]["tenant_name"] == "Arjun"
    assert data["active_lease"]["security_deposit_paise"] == 5_000_000
    assert data["active_lease"]["deposit_given_date"] == "2026-01-01"
    assert data["active_lease"]["deposit_status"] == "held"

    jan, feb = data["months"]
    assert jan["month_key"] == "2026-01"
    assert jan["rent_amount_paise"] == 1_450_000
    assert jan["rent_status"] == "paid_success"
    assert jan["rent_paid_date"] == "2026-01-05"
    assert jan["electric_amount_paise"] == 123_450
    assert jan["electric_status"] == "paid_success"
    assert jan["electric_paid_date"] == "2026-01-10"

    assert feb["month_key"] == "2026-02"
    assert feb["rent_status"] == "due_pending"
    assert feb["electric_amount_paise"] is None
    assert feb["electric_status"] == "blank"


def test_sqlite_v1_schema_migrates_non_destructively_with_backup(tmp_path):
    """Older SQLite schema without extra_data/schema_meta upgrades cleanly and preserves rows."""
    import sqlite3
    from app import models

    db_file = tmp_path / "legacy_v1.db"
    conn = sqlite3.connect(db_file)
    conn.executescript(
        """
        CREATE TABLE app_settings (
            id INTEGER PRIMARY KEY,
            currency VARCHAR(8) NOT NULL,
            default_rent_paise INTEGER NOT NULL,
            updated_at DATETIME NOT NULL
        );
        CREATE TABLE lease_periods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_name VARCHAR(120) NOT NULL,
            unit_label VARCHAR(120) NOT NULL,
            start_month VARCHAR(7) NOT NULL,
            end_month VARCHAR(7),
            status VARCHAR(20) NOT NULL,
            security_deposit_paise INTEGER NOT NULL,
            deposit_given_date VARCHAR(10),
            deposit_status VARCHAR(24) NOT NULL,
            deposit_returned_paise INTEGER,
            deposit_returned_date VARCHAR(10),
            deposit_notes TEXT NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL
        );
        CREATE TABLE rent_rate_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lease_id INTEGER NOT NULL,
            rent_amount_paise INTEGER NOT NULL,
            note VARCHAR(255) NOT NULL,
            created_at DATETIME NOT NULL
        );
        CREATE TABLE monthly_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lease_id INTEGER NOT NULL,
            month_key VARCHAR(7) NOT NULL,
            rent_amount_paise INTEGER NOT NULL,
            rent_status VARCHAR(20) NOT NULL,
            rent_paid_date VARCHAR(10),
            electric_amount_paise INTEGER,
            electric_status VARCHAR(20) NOT NULL,
            electric_paid_date VARCHAR(10),
            notes TEXT NOT NULL,
            client_mutation_id VARCHAR(64),
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL
        );
        INSERT INTO app_settings VALUES (1, 'INR', 1100000, '2026-01-01T00:00:00Z');
        INSERT INTO lease_periods VALUES (1, 'Legacy Tenant', 'Unit 1', '2026-01', NULL, 'active', 3000000, '01/01/2026', 'held', NULL, NULL, 'Old note', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
        INSERT INTO monthly_entries VALUES (1, 1, '2026-01', 1100000, 'paid', '05/01/2026', 85000, 'pending', NULL, 'Jan meter', NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
        """
    )
    conn.commit()
    conn.close()

    migrated_engine = db.create_db_engine(f"sqlite:///{db_file.as_posix()}")
    try:
        db.init_db(migrated_engine)
        backups = list(tmp_path.glob("legacy_v1.db.bak.v1.*"))
        assert len(backups) == 1

        with sessionmaker(bind=migrated_engine)() as session:
            meta = session.get(models.SchemaMeta, 1)
            assert meta is not None and meta.schema_version == 2
            lease = session.get(models.LeasePeriod, 1)
            assert lease is not None
            assert lease.tenant_name == "Legacy Tenant"
            assert lease.deposit_given_date == "2026-01-01"
            entry = session.get(models.MonthlyEntry, 1)
            assert entry is not None
            assert entry.rent_status == "paid_success"
            assert entry.rent_paid_date == "2026-01-05"
            assert entry.electric_status == "due_pending"
    finally:
        migrated_engine.dispose()


def test_delete_entire_history_resets_cleanly_to_jan_2026(client: TestClient):
    """DELETE /api/v1/history removes all history and resets to a fresh Jan-to-current ledger."""
    dash = client.get("/api/v1/dashboard").json()
    lease_id = dash["active_lease"]["id"]
    m1_id = dash["months"][0]["id"]

    client.put("/api/v1/settings/rent", json={"rent_amount_paise": 1_500_000, "note": "Setup"})
    client.put(
        f"/api/v1/leases/{lease_id}/deposit",
        json={"security_deposit_paise": 5_000_000, "deposit_given_date": "2026-01-01"},
    )
    client.post(f"/api/v1/months/{m1_id}/rent/toggle")
    client.patch(f"/api/v1/months/{m1_id}/electric", json={"electric_amount_paise": 100_000})

    reset_resp = client.delete("/api/v1/history")
    assert reset_resp.status_code == 200
    reset_data = reset_resp.json()

    assert reset_data["settings"]["default_rent_paise"] == 0
    assert reset_data["active_lease"]["security_deposit_paise"] == 0
    assert reset_data["active_lease"]["deposit_status"] == "not_set"
    assert reset_data["rate_history"] == []
    assert reset_data["months"][0]["month_key"].endswith("-01")
    assert all(m["rent_status"] == "due_pending" and m["electric_status"] == "blank" for m in reset_data["months"])

