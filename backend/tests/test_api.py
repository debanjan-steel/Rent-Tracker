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
    """App initializes in INR with one active lease and a month whose electric bill starts blank."""
    resp = client.get("/api/v1/dashboard")
    assert resp.status_code == 200
    data = resp.json()

    assert data["settings"]["currency"] == "INR"
    assert data["settings"]["default_rent_paise"] == 0
    assert data["active_lease"]["deposit_status"] == "not_set"
    assert len(data["months"]) == 1

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
    m1 = dash["months"][0]

    # Set initial rent to ₹10,000
    r1 = client.put("/api/v1/settings/rent", json={"rent_amount_paise": 1_000_000, "note": "Initial rent"})
    assert r1.status_code == 200
    assert r1.json()["updated_due_months_count"] == 1

    # Add month 2 and month 3 (auto-filled with ₹10,000 and due_pending)
    m2 = client.post(f"/api/v1/leases/{lease_id}/months", json={}).json()
    m3 = client.post(f"/api/v1/leases/{lease_id}/months", json={}).json()
    assert m2["rent_amount_paise"] == 1_000_000
    assert m3["rent_amount_paise"] == 1_000_000

    # Mark month 1 rent as paid_success
    pay_m1 = client.post(f"/api/v1/months/{m1['id']}/rent/toggle", json={"paid_date": "2026-11-05"})
    assert pay_m1.status_code == 200
    assert pay_m1.json()["rent_status"] == "paid_success"

    # Increase rent to ₹12,500 in Settings
    r2 = client.put("/api/v1/settings/rent", json={"rent_amount_paise": 1_250_000, "note": "Annual revision"})
    assert r2.status_code == 200
    assert r2.json()["updated_due_months_count"] == 2

    updated_dash = client.get("/api/v1/dashboard").json()
    months = updated_dash["months"]
    assert months[0]["rent_amount_paise"] == 1_000_000
    assert months[0]["rent_status"] == "paid_success"
    assert months[1]["rent_amount_paise"] == 1_250_000
    assert months[1]["rent_status"] == "due_pending"
    assert months[2]["rent_amount_paise"] == 1_250_000
    assert months[2]["rent_status"] == "due_pending"

    # Adding month 4 later picks up the new ₹12,500 rate
    m4 = client.post(f"/api/v1/leases/{lease_id}/months", json={}).json()
    assert m4["rent_amount_paise"] == 1_250_000
    assert m4["rent_status"] == "due_pending"


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

