"""Domain services implementing rent, electric bill, and security deposit rules."""

import csv
import io
from datetime import date
from typing import Any, Literal

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .migrations import CURRENT_SCHEMA_VERSION, migrate_backup_payload
from .models import AppSettings, LeasePeriod, MonthlyEntry, RentRateHistory, SchemaMeta, utc_now
from .schemas import (
    DashboardResponse,
    DashboardSummary,
    DepositReturnRequest,
    DepositUpdateRequest,
    LeasePeriodCreate,
    LeasePeriodUpdate,
)


def current_month_key() -> str:
    """Return the current YYYY-MM string."""
    return date.today().strftime("%Y-%m")


def default_start_month_key() -> str:
    """Return January of the current year (e.g. '2026-01')."""
    return f"{date.today().year:04d}-01"


def month_range_keys(start_month: str, end_month: str) -> list[str]:
    """Return inclusive chronological YYYY-MM keys from start_month to end_month."""
    if start_month > end_month:
        return [start_month]
    keys: list[str] = []
    cursor = start_month
    while cursor <= end_month:
        keys.append(cursor)
        cursor = next_month_key(cursor)
    return keys


def today_iso() -> str:
    """Return today's YYYY-MM-DD date string."""
    return date.today().isoformat()


def next_month_key(month_key: str) -> str:
    """Increment a YYYY-MM string by one calendar month."""
    year_str, month_str = month_key.split("-")
    year, month = int(year_str), int(month_str)
    if month == 12:
        return f"{year + 1:04d}-01"
    return f"{year:04d}-{month + 1:02d}"


def get_or_create_settings(session: Session) -> AppSettings:
    """Fetch singleton app settings, initializing INR defaults if missing."""
    settings = session.get(AppSettings, 1)
    if settings is None:
        settings = AppSettings(id=1, currency="INR", default_rent_paise=0, updated_at=utc_now())
        session.add(settings)
        session.commit()
        session.refresh(settings)
    return settings


def backfill_missing_months(session: Session, lease: LeasePeriod, start_month: str, end_month: str) -> int:
    """Create any missing MonthlyEntry rows between start_month and end_month."""
    settings = get_or_create_settings(session)
    existing_keys = set(
        session.scalars(select(MonthlyEntry.month_key).where(MonthlyEntry.lease_id == lease.id))
    )
    created = 0
    for month_key in month_range_keys(start_month, end_month):
        if month_key in existing_keys:
            continue
        session.add(
            MonthlyEntry(
                lease_id=lease.id,
                month_key=month_key,
                rent_amount_paise=settings.default_rent_paise,
                rent_status="due_pending",
                electric_amount_paise=None,
                electric_status="blank",
            )
        )
        created += 1
    return created


def ensure_initial_state(session: Session) -> LeasePeriod:
    """Ensure settings, a primary lease period, and Jan-to-current months exist."""
    get_or_create_settings(session)
    lease = session.scalar(select(LeasePeriod).order_by(LeasePeriod.id.asc()))
    default_start = default_start_month_key()
    current_month = current_month_key()

    if lease is None:
        lease = LeasePeriod(
            tenant_name="Primary Tenant",
            unit_label="Rental Unit",
            start_month=default_start,
            status="active",
            security_deposit_paise=0,
            deposit_status="not_set",
        )
        session.add(lease)
        session.flush()
        backfill_missing_months(session, lease, default_start, current_month)
        session.commit()
        session.refresh(lease)
    else:
        # If an untouched default lease was created starting at current_month, expand back to Jan of this year
        existing_months = list(
            session.scalars(select(MonthlyEntry).where(MonthlyEntry.lease_id == lease.id))
        )
        if (
            lease.start_month == current_month
            and default_start < current_month
            and lease.deposit_status == "not_set"
            and len(existing_months) == 1
            and existing_months[0].month_key == current_month
            and existing_months[0].rent_amount_paise == 0
            and existing_months[0].rent_status == "due_pending"
            and existing_months[0].electric_status == "blank"
        ):
            lease.start_month = default_start
            backfill_missing_months(session, lease, default_start, current_month)
            session.commit()
            session.refresh(lease)
    return lease


def get_lease_or_404(session: Session, lease_id: int | None = None) -> LeasePeriod:
    """Return requested lease (or primary active lease) or raise 404."""
    ensure_initial_state(session)
    if lease_id is None:
        lease = session.scalar(
            select(LeasePeriod).where(LeasePeriod.status == "active").order_by(LeasePeriod.id.asc())
        )
        if lease is None:
            lease = session.scalar(select(LeasePeriod).order_by(LeasePeriod.id.desc()))
    else:
        lease = session.get(LeasePeriod, lease_id)

    if lease is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lease period not found.")
    return lease


def get_month_or_404(session: Session, month_id: int) -> MonthlyEntry:
    """Return a MonthlyEntry by ID or raise 404."""
    entry = session.get(MonthlyEntry, month_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Monthly entry not found.")
    return entry


def compute_summary(lease: LeasePeriod, months: list[MonthlyEntry]) -> DashboardSummary:
    """Compute exact integer-paise financial totals for the dashboard."""
    total_rent_due = 0
    total_rent_paid = 0
    total_electric_due = 0
    total_electric_paid = 0
    due_months = 0
    paid_months = 0

    for entry in months:
        if entry.rent_status == "paid_success":
            total_rent_paid += entry.rent_amount_paise
        else:
            total_rent_due += entry.rent_amount_paise

        if entry.electric_amount_paise is not None:
            if entry.electric_status == "paid_success":
                total_electric_paid += entry.electric_amount_paise
            elif entry.electric_status == "due_pending":
                total_electric_due += entry.electric_amount_paise

        if entry.rent_status == "due_pending" or entry.electric_status == "due_pending":
            due_months += 1
        elif entry.rent_status == "paid_success" and entry.electric_status != "due_pending":
            paid_months += 1

    held_paise = lease.security_deposit_paise if lease.deposit_status == "held" else 0
    returned_paise = lease.deposit_returned_paise or 0

    return DashboardSummary(
        total_rent_due_paise=total_rent_due,
        total_rent_paid_paise=total_rent_paid,
        total_electric_due_paise=total_electric_due,
        total_electric_paid_paise=total_electric_paid,
        due_months_count=due_months,
        paid_months_count=paid_months,
        security_deposit_held_paise=held_paise,
        security_deposit_returned_paise=returned_paise,
    )


def build_dashboard(session: Session, lease_id: int | None = None) -> DashboardResponse:
    """Assemble full dashboard state for the selected lease period."""
    settings = get_or_create_settings(session)
    active_lease = get_lease_or_404(session, lease_id)
    leases = list(session.scalars(select(LeasePeriod).order_by(LeasePeriod.id.asc())))
    months = list(
        session.scalars(
            select(MonthlyEntry)
            .where(MonthlyEntry.lease_id == active_lease.id)
            .order_by(MonthlyEntry.month_key.asc())
        )
    )
    history = list(
        session.scalars(
            select(RentRateHistory)
            .where(RentRateHistory.lease_id == active_lease.id)
            .order_by(RentRateHistory.id.desc())
        )
    )
    summary = compute_summary(active_lease, months)
    return DashboardResponse(
        schema_version=CURRENT_SCHEMA_VERSION,
        settings=settings,
        active_lease=active_lease,
        leases=leases,
        months=months,
        rate_history=history,
        summary=summary,
    )


def update_rent_rate(
    session: Session,
    rent_amount_paise: int,
    lease_id: int | None = None,
    note: str = "",
) -> tuple[AppSettings, int, RentRateHistory]:
    """Update base rent and propagate ONLY to months whose rent is still due_pending."""
    settings = get_or_create_settings(session)
    lease = get_lease_or_404(session, lease_id)
    now = utc_now()

    settings.default_rent_paise = rent_amount_paise
    settings.updated_at = now

    due_months = list(
        session.scalars(
            select(MonthlyEntry).where(
                MonthlyEntry.lease_id == lease.id,
                MonthlyEntry.rent_status == "due_pending",
            )
        )
    )
    for entry in due_months:
        entry.rent_amount_paise = rent_amount_paise
        entry.updated_at = now

    history_item = RentRateHistory(
        lease_id=lease.id,
        rent_amount_paise=rent_amount_paise,
        note=note.strip() or "Updated rent rate",
        created_at=now,
    )
    session.add(history_item)
    session.commit()
    session.refresh(settings)
    session.refresh(history_item)
    return settings, len(due_months), history_item


def create_lease_period(session: Session, payload: LeasePeriodCreate) -> LeasePeriod:
    """Create a new tenancy / renting period (supports multi-tenant expansion)."""
    settings = get_or_create_settings(session)
    deposit_status = "held" if payload.security_deposit_paise > 0 else "not_set"
    lease = LeasePeriod(
        tenant_name=payload.tenant_name.strip(),
        unit_label=payload.unit_label.strip(),
        start_month=payload.start_month,
        status="active",
        security_deposit_paise=payload.security_deposit_paise,
        deposit_given_date=payload.deposit_given_date,
        deposit_status=deposit_status,
        deposit_notes=payload.deposit_notes.strip(),
    )
    session.add(lease)
    session.flush()

    first_month = MonthlyEntry(
        lease_id=lease.id,
        month_key=payload.start_month,
        rent_amount_paise=settings.default_rent_paise,
        rent_status="due_pending",
        electric_amount_paise=None,
        electric_status="blank",
    )
    session.add(first_month)
    session.commit()
    session.refresh(lease)
    return lease


def update_lease_period(session: Session, lease: LeasePeriod, payload: LeasePeriodUpdate) -> LeasePeriod:
    """Update tenant name, unit label, dates, or active/ended status."""
    previous_start = lease.start_month
    for field in ("tenant_name", "unit_label", "start_month", "end_month", "status"):
        value = getattr(payload, field)
        if value is not None:
            setattr(lease, field, value.strip() if isinstance(value, str) else value)
    if payload.start_month is not None and payload.start_month < previous_start:
        backfill_missing_months(session, lease, payload.start_month, current_month_key())
    lease.updated_at = utc_now()
    session.commit()
    session.refresh(lease)
    return lease


def update_security_deposit(session: Session, lease: LeasePeriod, payload: DepositUpdateRequest) -> LeasePeriod:
    """Record or adjust the security deposit given at the start of the renting period."""
    lease.security_deposit_paise = payload.security_deposit_paise
    lease.deposit_given_date = payload.deposit_given_date
    lease.deposit_notes = payload.deposit_notes.strip()

    if payload.security_deposit_paise == 0:
        lease.deposit_status = "not_set"
        lease.deposit_returned_paise = None
        lease.deposit_returned_date = None
    elif lease.deposit_status == "not_set":
        lease.deposit_status = "held"

    lease.updated_at = utc_now()
    session.commit()
    session.refresh(lease)
    return lease


def settle_security_deposit(session: Session, lease: LeasePeriod, payload: DepositReturnRequest) -> LeasePeriod:
    """Mark the security deposit returned when the renting period ends."""
    if lease.security_deposit_paise <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Set a security deposit amount before marking it returned.",
        )
    if payload.deposit_returned_paise > lease.security_deposit_paise:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Returned deposit cannot exceed original security deposit held.",
        )

    lease.deposit_returned_paise = payload.deposit_returned_paise
    lease.deposit_returned_date = payload.deposit_returned_date or today_iso()
    lease.deposit_status = (
        "returned"
        if payload.deposit_returned_paise == lease.security_deposit_paise
        else "partially_returned"
    )
    if payload.deposit_notes.strip():
        lease.deposit_notes = payload.deposit_notes.strip()
    if payload.end_month is not None:
        lease.end_month = payload.end_month
    if payload.mark_lease_ended:
        lease.status = "ended"

    lease.updated_at = utc_now()
    session.commit()
    session.refresh(lease)
    return lease


def reopen_security_deposit(session: Session, lease: LeasePeriod) -> LeasePeriod:
    """Revert a returned deposit back to held (for undoing accidental settlement)."""
    lease.deposit_status = "held" if lease.security_deposit_paise > 0 else "not_set"
    lease.deposit_returned_paise = None
    lease.deposit_returned_date = None
    lease.status = "active"
    lease.updated_at = utc_now()
    session.commit()
    session.refresh(lease)
    return lease


def add_month_entry(
    session: Session,
    lease: LeasePeriod,
    month_key: str | None = None,
    notes: str = "",
    client_mutation_id: str | None = None,
) -> MonthlyEntry:
    """Manually add a month row pre-filled with current rent (due_pending) and blank electric bill."""
    if client_mutation_id:
        existing_by_mutation = session.scalar(
            select(MonthlyEntry).where(
                MonthlyEntry.lease_id == lease.id,
                MonthlyEntry.client_mutation_id == client_mutation_id,
            )
        )
        if existing_by_mutation is not None:
            return existing_by_mutation

    if month_key is None:
        latest = session.scalar(
            select(MonthlyEntry)
            .where(MonthlyEntry.lease_id == lease.id)
            .order_by(MonthlyEntry.month_key.desc())
        )
        target_month = next_month_key(latest.month_key) if latest else lease.start_month
    else:
        target_month = month_key

    duplicate = session.scalar(
        select(MonthlyEntry).where(
            MonthlyEntry.lease_id == lease.id,
            MonthlyEntry.month_key == target_month,
        )
    )
    if duplicate is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Month {target_month} already exists.",
        )

    settings = get_or_create_settings(session)
    entry = MonthlyEntry(
        lease_id=lease.id,
        month_key=target_month,
        rent_amount_paise=settings.default_rent_paise,
        rent_status="due_pending",
        electric_amount_paise=None,
        electric_status="blank",
        notes=notes.strip(),
        client_mutation_id=client_mutation_id,
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


def update_electric_bill(
    session: Session,
    entry: MonthlyEntry,
    electric_amount_paise: int | None,
    notes: str | None = None,
    client_mutation_id: str | None = None,
) -> MonthlyEntry:
    """Set or clear the month's electric bill amount.

    Blank (None) -> status 'blank'.
    Numeric value entered -> status becomes 'due_pending' (unless already 'paid_success').
    """
    if electric_amount_paise is None:
        entry.electric_amount_paise = None
        entry.electric_status = "blank"
        entry.electric_paid_date = None
    else:
        entry.electric_amount_paise = electric_amount_paise
        if entry.electric_status == "blank":
            entry.electric_status = "due_pending"

    if notes is not None:
        entry.notes = notes.strip()
    if client_mutation_id is not None:
        entry.client_mutation_id = client_mutation_id

    entry.updated_at = utc_now()
    session.commit()
    session.refresh(entry)
    return entry


def toggle_payment_status(
    session: Session,
    entry: MonthlyEntry,
    kind: Literal["rent", "electric"],
    target_status: Literal["due_pending", "paid_success"] | None = None,
    paid_date: str | None = None,
    client_mutation_id: str | None = None,
) -> MonthlyEntry:
    """Manually transition rent or electric bill between due_pending and paid_success."""
    if kind == "electric":
        if entry.electric_status == "blank" or entry.electric_amount_paise is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Enter an electric bill amount before marking it paid.",
            )
        next_status = target_status or ("paid_success" if entry.electric_status == "due_pending" else "due_pending")
        entry.electric_status = next_status
        entry.electric_paid_date = (paid_date or entry.electric_paid_date or today_iso()) if next_status == "paid_success" else None
    else:
        next_status = target_status or ("paid_success" if entry.rent_status == "due_pending" else "due_pending")
        entry.rent_status = next_status
        entry.rent_paid_date = (paid_date or entry.rent_paid_date or today_iso()) if next_status == "paid_success" else None

    if client_mutation_id is not None:
        entry.client_mutation_id = client_mutation_id
    entry.updated_at = utc_now()
    session.commit()
    session.refresh(entry)
    return entry


def _format_paise_decimal(amount_paise: int | None) -> str:
    """Format integer paise as decimal INR string for CSV export."""
    if amount_paise is None:
        return ""
    rupees, paise = divmod(amount_paise, 100)
    return f"{rupees}.{paise:02d}"


def build_csv_export(session: Session, lease_id: int | None = None) -> str:
    """Generate a CSV ledger containing monthly entries and security deposit details."""
    dashboard = build_dashboard(session, lease_id)
    lease = dashboard.active_lease
    buf = io.StringIO()
    writer = csv.writer(buf)

    writer.writerow(["Tenant", lease.tenant_name, "Unit", lease.unit_label, "Currency", dashboard.settings.currency])
    writer.writerow(
        [
            "Security Deposit Held (INR)",
            _format_paise_decimal(lease.security_deposit_paise),
            "Deposit Status",
            lease.deposit_status,
            "Deposit Returned (INR)",
            _format_paise_decimal(lease.deposit_returned_paise),
        ]
    )
    writer.writerow([])
    writer.writerow(
        [
            "Month",
            "Rent (INR)",
            "Rent Status",
            "Rent Paid Date",
            "Electric Bill (INR)",
            "Electric Status",
            "Electric Paid Date",
            "Total (INR)",
            "Notes",
        ]
    )

    for entry in dashboard.months:
        total_paise = entry.rent_amount_paise + (entry.electric_amount_paise or 0)
        writer.writerow(
            [
                entry.month_key,
                _format_paise_decimal(entry.rent_amount_paise),
                entry.rent_status,
                entry.rent_paid_date or "",
                _format_paise_decimal(entry.electric_amount_paise),
                entry.electric_status,
                entry.electric_paid_date or "",
                _format_paise_decimal(total_paise),
                entry.notes,
            ]
        )

    return buf.getvalue()


def import_backup_payload(session: Session, raw_payload: dict[str, Any]) -> DashboardResponse:
    """Validate, migrate from any supported format, and restore saved user data safely."""
    migrated = migrate_backup_payload(raw_payload)
    now = utc_now()

    settings = get_or_create_settings(session)
    settings.currency = migrated["settings"]["currency"]
    settings.default_rent_paise = migrated["settings"]["default_rent_paise"]
    settings.updated_at = now

    # Clear existing lease children & leases inside this transaction after payload validated
    session.execute(delete(MonthlyEntry))
    session.execute(delete(RentRateHistory))
    session.execute(delete(LeasePeriod))
    session.flush()

    lease_id_map: dict[Any, int] = {}
    created_leases: list[LeasePeriod] = []
    for lease_data in migrated["leases"]:
        lease = LeasePeriod(
            tenant_name=lease_data["tenant_name"],
            unit_label=lease_data["unit_label"],
            start_month=lease_data["start_month"],
            end_month=lease_data["end_month"],
            status=lease_data["status"],
            security_deposit_paise=lease_data["security_deposit_paise"],
            deposit_given_date=lease_data["deposit_given_date"],
            deposit_status=lease_data["deposit_status"],
            deposit_returned_paise=lease_data["deposit_returned_paise"],
            deposit_returned_date=lease_data["deposit_returned_date"],
            deposit_notes=lease_data["deposit_notes"],
            extra_data=lease_data["extra_data"],
            created_at=now,
            updated_at=now,
        )
        session.add(lease)
        session.flush()
        created_leases.append(lease)
        if lease_data["legacy_id"] is not None:
            lease_id_map[lease_data["legacy_id"]] = lease.id

    fallback_lease_id = created_leases[0].id
    seen_lease_months: set[tuple[int, str]] = set()
    for month_data in migrated["months"]:
        target_lease_id = lease_id_map.get(month_data["legacy_lease_id"], fallback_lease_id)
        key = (target_lease_id, month_data["month_key"])
        if key in seen_lease_months:
            continue
        seen_lease_months.add(key)
        session.add(
            MonthlyEntry(
                lease_id=target_lease_id,
                month_key=month_data["month_key"],
                rent_amount_paise=month_data["rent_amount_paise"],
                rent_status=month_data["rent_status"],
                rent_paid_date=month_data["rent_paid_date"],
                electric_amount_paise=month_data["electric_amount_paise"],
                electric_status=month_data["electric_status"],
                electric_paid_date=month_data["electric_paid_date"],
                notes=month_data["notes"],
                extra_data=month_data["extra_data"],
                client_mutation_id=month_data["client_mutation_id"],
                created_at=now,
                updated_at=now,
            )
        )

    for hist in migrated["rate_history"]:
        target_lease_id = lease_id_map.get(hist["legacy_lease_id"], fallback_lease_id)
        session.add(
            RentRateHistory(
                lease_id=target_lease_id,
                rent_amount_paise=hist["rent_amount_paise"],
                note=hist["note"],
                created_at=now,
            )
        )

    meta = session.get(SchemaMeta, 1)
    if meta is None:
        session.add(SchemaMeta(id=1, schema_version=CURRENT_SCHEMA_VERSION, updated_at=now))
    else:
        meta.schema_version = CURRENT_SCHEMA_VERSION
        meta.updated_at = now

    session.commit()
    return build_dashboard(session, lease_id=fallback_lease_id)


def reset_all_history(session: Session) -> DashboardResponse:
    """Delete all stored rent, electric, deposit, and settings history and re-seed fresh defaults."""
    session.execute(delete(MonthlyEntry))
    session.execute(delete(RentRateHistory))
    session.execute(delete(LeasePeriod))
    session.execute(delete(AppSettings))
    session.commit()
    ensure_initial_state(session)
    return build_dashboard(session)
