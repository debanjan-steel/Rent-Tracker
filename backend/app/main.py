"""FastAPI application entrypoint and REST routes for the Rent Tracker PWA."""

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from . import db
from .db import get_session
from .schemas import (
    DashboardResponse,
    DepositReturnRequest,
    DepositUpdateRequest,
    ElectricUpdateRequest,
    LeasePeriodCreate,
    LeasePeriodRead,
    LeasePeriodUpdate,
    MonthCreateRequest,
    MonthlyEntryRead,
    MonthNotesUpdateRequest,
    RentRateUpdateRequest,
    RentRateUpdateResponse,
    StatusToggleRequest,
)
from .services import (
    add_month_entry,
    build_csv_export,
    build_dashboard,
    create_lease_period,
    ensure_initial_state,
    get_lease_or_404,
    get_month_or_404,
    import_backup_payload,
    reopen_security_deposit,
    settle_security_deposit,
    toggle_payment_status,
    update_electric_bill,
    update_lease_period,
    update_rent_rate,
    update_security_deposit,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Initialize SQLite schema and primary lease record on app boot."""
    db.init_db()
    with db.SessionLocal() as session:
        ensure_initial_state(session)
    yield


app = FastAPI(
    title="Rent & Electric Bill Tracker API",
    version="0.1.0",
    lifespan=lifespan,
)

default_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]
extra_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=default_origins + extra_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/v1/health")
@app.head("/api/v1/health", include_in_schema=False)
def health_check() -> dict[str, str]:
    """Basic health probe (supports GET and HEAD for uptime monitors)."""
    return {"status": "ok"}


@app.get("/api/v1/dashboard", response_model=DashboardResponse)
def get_dashboard(
    lease_id: int | None = Query(default=None),
    session: Session = Depends(get_session),
) -> DashboardResponse:
    """Return settings, active lease, security deposit, monthly entries, and summary."""
    return build_dashboard(session, lease_id=lease_id)


@app.put("/api/v1/settings/rent", response_model=RentRateUpdateResponse)
def set_rent_rate(
    payload: RentRateUpdateRequest,
    session: Session = Depends(get_session),
) -> RentRateUpdateResponse:
    """Update base monthly rent and apply it to all due_pending months only."""
    settings, updated_count, history_item = update_rent_rate(
        session,
        rent_amount_paise=payload.rent_amount_paise,
        lease_id=payload.lease_id,
        note=payload.note,
    )
    return RentRateUpdateResponse(
        settings=settings,
        updated_due_months_count=updated_count,
        rate_history_entry=history_item,
    )


@app.post("/api/v1/leases", response_model=LeasePeriodRead, status_code=201)
def create_lease(
    payload: LeasePeriodCreate,
    session: Session = Depends(get_session),
) -> LeasePeriodRead:
    """Create a new renting period / tenant lease."""
    return create_lease_period(session, payload)


@app.put("/api/v1/leases/{lease_id}", response_model=LeasePeriodRead)
def patch_lease(
    lease_id: int,
    payload: LeasePeriodUpdate,
    session: Session = Depends(get_session),
) -> LeasePeriodRead:
    """Update tenant name, unit label, or lease status."""
    lease = get_lease_or_404(session, lease_id)
    return update_lease_period(session, lease, payload)


@app.put("/api/v1/leases/{lease_id}/deposit", response_model=LeasePeriodRead)
def put_deposit(
    lease_id: int,
    payload: DepositUpdateRequest,
    session: Session = Depends(get_session),
) -> LeasePeriodRead:
    """Record or edit security deposit given at the start of the renting period."""
    lease = get_lease_or_404(session, lease_id)
    return update_security_deposit(session, lease, payload)


@app.post("/api/v1/leases/{lease_id}/deposit/return", response_model=LeasePeriodRead)
def return_deposit(
    lease_id: int,
    payload: DepositReturnRequest,
    session: Session = Depends(get_session),
) -> LeasePeriodRead:
    """Mark the security deposit returned when the renting period ends."""
    lease = get_lease_or_404(session, lease_id)
    return settle_security_deposit(session, lease, payload)


@app.post("/api/v1/leases/{lease_id}/deposit/reopen", response_model=LeasePeriodRead)
def undo_return_deposit(
    lease_id: int,
    session: Session = Depends(get_session),
) -> LeasePeriodRead:
    """Revert a returned security deposit back to held."""
    lease = get_lease_or_404(session, lease_id)
    return reopen_security_deposit(session, lease)


@app.post("/api/v1/leases/{lease_id}/months", response_model=MonthlyEntryRead, status_code=201)
def create_month(
    lease_id: int,
    payload: MonthCreateRequest,
    session: Session = Depends(get_session),
) -> MonthlyEntryRead:
    """Manually add a month pre-filled with configured rent and blank electric bill."""
    lease = get_lease_or_404(session, lease_id)
    return add_month_entry(
        session,
        lease=lease,
        month_key=payload.month_key,
        notes=payload.notes,
        client_mutation_id=payload.client_mutation_id,
    )


@app.delete("/api/v1/months/{month_id}", status_code=204)
def delete_month(
    month_id: int,
    session: Session = Depends(get_session),
) -> Response:
    """Delete a monthly entry."""
    entry = get_month_or_404(session, month_id)
    session.delete(entry)
    session.commit()
    return Response(status_code=204)


@app.patch("/api/v1/months/{month_id}/electric", response_model=MonthlyEntryRead)
def patch_electric_bill(
    month_id: int,
    payload: ElectricUpdateRequest,
    session: Session = Depends(get_session),
) -> MonthlyEntryRead:
    """Enter or clear a month's manual electric bill amount."""
    entry = get_month_or_404(session, month_id)
    return update_electric_bill(
        session,
        entry=entry,
        electric_amount_paise=payload.electric_amount_paise,
        notes=payload.notes,
        client_mutation_id=payload.client_mutation_id,
    )


@app.post("/api/v1/months/{month_id}/rent/toggle", response_model=MonthlyEntryRead)
def toggle_rent(
    month_id: int,
    payload: StatusToggleRequest | None = None,
    session: Session = Depends(get_session),
) -> MonthlyEntryRead:
    """Manually toggle month rent between due_pending and paid_success."""
    entry = get_month_or_404(session, month_id)
    return toggle_payment_status(
        session,
        entry=entry,
        kind="rent",
        target_status=payload.target_status if payload else None,
        paid_date=payload.paid_date if payload else None,
        client_mutation_id=payload.client_mutation_id if payload else None,
    )


@app.post("/api/v1/months/{month_id}/electric/toggle", response_model=MonthlyEntryRead)
def toggle_electric(
    month_id: int,
    payload: StatusToggleRequest | None = None,
    session: Session = Depends(get_session),
) -> MonthlyEntryRead:
    """Manually toggle month electric bill between due_pending and paid_success."""
    entry = get_month_or_404(session, month_id)
    return toggle_payment_status(
        session,
        entry=entry,
        kind="electric",
        target_status=payload.target_status if payload else None,
        paid_date=payload.paid_date if payload else None,
        client_mutation_id=payload.client_mutation_id if payload else None,
    )


@app.patch("/api/v1/months/{month_id}/notes", response_model=MonthlyEntryRead)
def patch_notes(
    month_id: int,
    payload: MonthNotesUpdateRequest,
    session: Session = Depends(get_session),
) -> MonthlyEntryRead:
    """Update optional notes on a monthly entry."""
    entry = get_month_or_404(session, month_id)
    entry.notes = payload.notes.strip()
    session.commit()
    session.refresh(entry)
    return entry


@app.get("/api/v1/export/csv")
def export_csv(
    lease_id: int | None = Query(default=None),
    session: Session = Depends(get_session),
) -> PlainTextResponse:
    """Download monthly rent, electric bill, and deposit ledger as CSV."""
    csv_body = build_csv_export(session, lease_id=lease_id)
    return PlainTextResponse(
        content=csv_body,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="rent-ledger.csv"'},
    )


@app.get("/api/v1/export/json", response_model=DashboardResponse)
def export_json(
    lease_id: int | None = Query(default=None),
    session: Session = Depends(get_session),
) -> DashboardResponse:
    """Download complete dashboard state as JSON backup."""
    return build_dashboard(session, lease_id=lease_id)


@app.post("/api/v1/import/json", response_model=DashboardResponse)
def import_json(
    payload: dict[str, Any] = Body(...),
    session: Session = Depends(get_session),
) -> DashboardResponse:
    """Restore and migrate any supported backup JSON format without deleting data."""
    return import_backup_payload(session, payload)


# Serve production PWA bundle when built
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API endpoint not found.")
        dist_root = FRONTEND_DIST.resolve()
        candidate = (FRONTEND_DIST / full_path).resolve()
        if full_path and candidate.is_relative_to(dist_root) and candidate.is_file():
            if candidate.name == "manifest.webmanifest":
                return FileResponse(candidate, media_type="application/manifest+json")
            if candidate.name == "sw.js":
                return FileResponse(
                    candidate,
                    media_type="application/javascript",
                    headers={"Cache-Control": "no-cache"},
                )
            return FileResponse(candidate)
        return FileResponse(
            FRONTEND_DIST / "index.html",
            headers={"Cache-Control": "no-cache"},
        )
