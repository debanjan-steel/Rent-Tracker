"""Non-destructive schema migrations and input-format transformers.

Ensures saved user records are preserved and converted forward across app updates
or input-format changes without deleting data.
"""

import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from .models import LeasePeriod, MonthlyEntry, SchemaMeta, utc_now

CURRENT_SCHEMA_VERSION = 2

MONTH_NAME_MAP = {
    "jan": "01",
    "january": "01",
    "feb": "02",
    "february": "02",
    "mar": "03",
    "march": "03",
    "apr": "04",
    "april": "04",
    "may": "05",
    "jun": "06",
    "june": "06",
    "jul": "07",
    "july": "07",
    "aug": "08",
    "august": "08",
    "sep": "09",
    "sept": "09",
    "september": "09",
    "oct": "10",
    "october": "10",
    "nov": "11",
    "november": "11",
    "dec": "12",
    "december": "12",
}


def normalize_amount_to_paise(
    raw_paise: Any = None,
    raw_rupees: Any = None,
    *,
    allow_none: bool = False,
) -> int | None:
    """Convert paise or legacy rupee strings/numbers safely into integer paise."""
    if raw_paise is not None and raw_paise != "":
        if isinstance(raw_paise, (int, float)):
            return max(0, int(round(raw_paise)))
        cleaned = re.sub(r"[^\d.]", "", str(raw_paise))
        if cleaned:
            return max(0, int(round(float(cleaned))))

    if raw_rupees is not None and str(raw_rupees).strip() != "":
        if isinstance(raw_rupees, (int, float)):
            return max(0, int(round(float(raw_rupees) * 100)))
        cleaned = re.sub(r"[^\d.]", "", str(raw_rupees))
        if cleaned:
            return max(0, int(round(float(cleaned) * 100)))

    return None if allow_none else 0


def normalize_month_key(raw: Any, fallback: str = "2026-01") -> str:
    """Convert 'YYYY-MM', 'YYYY/MM', 'MM-YYYY', or 'Jan 2026' into 'YYYY-MM'."""
    if not raw:
        return fallback
    text_val = str(raw).strip()

    if m := re.match(r"^(\d{4})[-/](\d{1,2})$", text_val):
        year, month = int(m.group(1)), int(m.group(2))
        if 1 <= month <= 12:
            return f"{year:04d}-{month:02d}"

    if m := re.match(r"^(\d{1,2})[-/](\d{4})$", text_val):
        month, year = int(m.group(1)), int(m.group(2))
        if 1 <= month <= 12:
            return f"{year:04d}-{month:02d}"

    if m := re.match(r"^([A-Za-z]+)\s+(\d{4})$", text_val):
        month_num = MONTH_NAME_MAP.get(m.group(1).lower())
        if month_num:
            return f"{int(m.group(2)):04d}-{month_num}"

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Unrecognized month format: {text_val}",
    )


def normalize_date_str(raw: Any) -> str | None:
    """Convert 'YYYY-MM-DD', 'YYYY/MM/DD', 'DD/MM/YYYY', or 'DD-MM-YYYY' into 'YYYY-MM-DD'."""
    if raw is None or str(raw).strip() == "":
        return None
    text_val = str(raw).strip()

    if m := re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$", text_val):
        return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"

    if m := re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$", text_val):
        return f"{int(m.group(3)):04d}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"

    return text_val[:10]


def normalize_payment_status(raw: Any, *, allow_blank: bool = False, has_amount: bool = True) -> str:
    """Map legacy or alternate status labels cleanly to current canonical statuses."""
    if raw is None or str(raw).strip() == "":
        if allow_blank and not has_amount:
            return "blank"
        return "due_pending"

    if isinstance(raw, bool):
        return "paid_success" if raw else "due_pending"

    lowered = str(raw).strip().lower()
    if lowered in {"paid_success", "paid", "success", "completed", "done", "settled", "true", "yes"}:
        return "paid_success"
    if lowered in {"blank", "empty", "none", "unentered", "not_entered"} and allow_blank and not has_amount:
        return "blank"
    if lowered in {"due_pending", "due", "pending", "due / pending", "unpaid", "false", "no"}:
        return "due_pending"

    return "blank" if (allow_blank and not has_amount) else "due_pending"


def _backup_sqlite_before_migration(engine: Engine, from_version: int) -> None:
    """Save a safety copy of the SQLite database file prior to running schema migrations."""
    if engine.url.get_backend_name() != "sqlite":
        return
    db_name = engine.url.database
    if not db_name or db_name == ":memory:":
        return
    db_path = Path(db_name)
    if not db_path.exists() or db_path.stat().st_size == 0:
        return
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = db_path.with_name(f"{db_path.name}.bak.v{from_version}.{stamp}")
    if not backup_path.exists():
        shutil.copy2(db_path, backup_path)


def _ensure_column(engine: Engine, table_name: str, column_name: str, ddl_type: str) -> None:
    """Add a missing column non-destructively if an older database lacks it."""
    inspector = inspect(engine)
    existing_cols = {col["name"] for col in inspector.get_columns(table_name)}
    if column_name not in existing_cols:
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl_type}"))


def run_migrations(engine: Engine) -> None:
    """Apply additive schema upgrades and non-destructive value normalizations."""
    with Session(engine) as session:
        meta = session.get(SchemaMeta, 1)
        current_version = meta.schema_version if meta is not None else 1

    if current_version < CURRENT_SCHEMA_VERSION:
        _backup_sqlite_before_migration(engine, current_version)

    # Non-destructive column additions (preserves all existing rows)
    _ensure_column(engine, "lease_periods", "extra_data", "TEXT NOT NULL DEFAULT '{}'")
    _ensure_column(engine, "monthly_entries", "extra_data", "TEXT NOT NULL DEFAULT '{}'")

    with Session(engine) as session:
        # Normalize any legacy status / date values in-place without deleting rows
        for lease in session.scalars(select(LeasePeriod)):
            if lease.deposit_given_date:
                lease.deposit_given_date = normalize_date_str(lease.deposit_given_date)
            if lease.deposit_returned_date:
                lease.deposit_returned_date = normalize_date_str(lease.deposit_returned_date)
            if lease.deposit_status == "not_set" and lease.security_deposit_paise > 0:
                lease.deposit_status = "held"

        for entry in session.scalars(select(MonthlyEntry)):
            entry.rent_status = normalize_payment_status(entry.rent_status, allow_blank=False)
            has_electric = entry.electric_amount_paise is not None
            entry.electric_status = normalize_payment_status(
                entry.electric_status, allow_blank=True, has_amount=has_electric
            )
            if entry.rent_paid_date:
                entry.rent_paid_date = normalize_date_str(entry.rent_paid_date)
            if entry.electric_paid_date:
                entry.electric_paid_date = normalize_date_str(entry.electric_paid_date)

        meta = session.get(SchemaMeta, 1)
        if meta is None:
            meta = SchemaMeta(id=1, schema_version=CURRENT_SCHEMA_VERSION, updated_at=utc_now())
            session.add(meta)
        else:
            meta.schema_version = CURRENT_SCHEMA_VERSION
            meta.updated_at = utc_now()
        session.commit()


def _extract_extra_json(obj: dict[str, Any], known_keys: set[str]) -> str:
    """Preserve any unrecognized or legacy fields inside extra_data JSON."""
    existing_extra = obj.get("extra_data")
    merged: dict[str, Any] = {}
    if isinstance(existing_extra, str) and existing_extra.strip():
        try:
            parsed = json.loads(existing_extra)
            if isinstance(parsed, dict):
                merged.update(parsed)
        except json.JSONDecodeError:
            merged["legacy_extra_raw"] = existing_extra
    elif isinstance(existing_extra, dict):
        merged.update(existing_extra)

    for key, val in obj.items():
        if key not in known_keys and val is not None:
            merged[key] = val

    return json.dumps(merged, ensure_ascii=False)


def migrate_backup_payload(raw_payload: dict[str, Any]) -> dict[str, Any]:
    """Transform v1, v2, or legacy rupee/string backup payloads into normalized v2 data."""
    if not isinstance(raw_payload, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Backup must be a JSON object.")

    raw_settings = raw_payload.get("settings") or {}
    default_rent_paise = normalize_amount_to_paise(
        raw_settings.get("default_rent_paise"),
        raw_settings.get("default_rent") or raw_settings.get("monthly_rent") or raw_payload.get("monthly_rent"),
    )
    settings_out = {
        "currency": str(raw_settings.get("currency") or "INR")[:8],
        "default_rent_paise": default_rent_paise or 0,
    }

    raw_leases = raw_payload.get("leases")
    if not raw_leases:
        single_lease = raw_payload.get("active_lease") or raw_payload.get("lease")
        raw_leases = [single_lease] if isinstance(single_lease, dict) else [{}]

    known_lease_keys = {
        "id",
        "tenant_name",
        "unit_label",
        "start_month",
        "end_month",
        "status",
        "security_deposit_paise",
        "security_deposit",
        "deposit_given_date",
        "deposit_status",
        "deposit_returned_paise",
        "deposit_returned",
        "deposit_returned_date",
        "deposit_notes",
        "extra_data",
        "created_at",
        "updated_at",
    }

    leases_out: list[dict[str, Any]] = []
    for item in raw_leases:
        if not isinstance(item, dict):
            continue
        deposit_paise = normalize_amount_to_paise(
            item.get("security_deposit_paise"),
            item.get("security_deposit"),
        ) or 0
        returned_paise = normalize_amount_to_paise(
            item.get("deposit_returned_paise"),
            item.get("deposit_returned"),
            allow_none=True,
        )
        raw_dep_status = str(item.get("deposit_status") or "").strip().lower()
        if returned_paise is not None and raw_dep_status in {"returned", "partially_returned"}:
            dep_status = raw_dep_status
        elif returned_paise is not None:
            dep_status = "returned" if returned_paise >= deposit_paise else "partially_returned"
        elif deposit_paise > 0:
            dep_status = "held"
        else:
            dep_status = "not_set"

        leases_out.append(
            {
                "legacy_id": item.get("id"),
                "tenant_name": str(item.get("tenant_name") or "Primary Tenant").strip()[:120],
                "unit_label": str(item.get("unit_label") or "Rental Unit").strip()[:120],
                "start_month": normalize_month_key(item.get("start_month"), fallback="2026-01"),
                "end_month": normalize_month_key(item["end_month"]) if item.get("end_month") else None,
                "status": "ended" if str(item.get("status", "")).lower() == "ended" else "active",
                "security_deposit_paise": deposit_paise,
                "deposit_given_date": normalize_date_str(item.get("deposit_given_date")),
                "deposit_status": dep_status,
                "deposit_returned_paise": returned_paise,
                "deposit_returned_date": normalize_date_str(item.get("deposit_returned_date")),
                "deposit_notes": str(item.get("deposit_notes") or ""),
                "extra_data": _extract_extra_json(item, known_lease_keys),
            }
        )

    if not leases_out:
        leases_out.append(
            {
                "legacy_id": None,
                "tenant_name": "Primary Tenant",
                "unit_label": "Rental Unit",
                "start_month": "2026-01",
                "end_month": None,
                "status": "active",
                "security_deposit_paise": 0,
                "deposit_given_date": None,
                "deposit_status": "not_set",
                "deposit_returned_paise": None,
                "deposit_returned_date": None,
                "deposit_notes": "",
                "extra_data": "{}",
            }
        )

    raw_months = raw_payload.get("months")
    if raw_months is None or not isinstance(raw_months, list):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Backup JSON must contain a 'months' array.",
        )

    known_month_keys = {
        "id",
        "lease_id",
        "month_key",
        "month",
        "rent_amount_paise",
        "rent_amount",
        "rent",
        "rent_status",
        "rent_paid",
        "rent_paid_date",
        "electric_amount_paise",
        "electric_amount",
        "electric_bill",
        "electric",
        "electric_status",
        "electric_paid",
        "electric_paid_date",
        "notes",
        "extra_data",
        "client_mutation_id",
        "created_at",
        "updated_at",
    }

    months_out: list[dict[str, Any]] = []
    for m in raw_months:
        if not isinstance(m, dict):
            continue
        month_key = normalize_month_key(m.get("month_key") or m.get("month"))
        rent_paise = normalize_amount_to_paise(
            m.get("rent_amount_paise"),
            m.get("rent_amount") if m.get("rent_amount") is not None else m.get("rent"),
        ) or 0
        electric_paise = normalize_amount_to_paise(
            m.get("electric_amount_paise"),
            m.get("electric_amount")
            if m.get("electric_amount") is not None
            else (m.get("electric_bill") if m.get("electric_bill") is not None else m.get("electric")),
            allow_none=True,
        )
        rent_status = normalize_payment_status(
            m.get("rent_status") if m.get("rent_status") is not None else m.get("rent_paid"),
            allow_blank=False,
        )
        electric_status = normalize_payment_status(
            m.get("electric_status") if m.get("electric_status") is not None else m.get("electric_paid"),
            allow_blank=True,
            has_amount=electric_paise is not None,
        )
        months_out.append(
            {
                "legacy_lease_id": m.get("lease_id"),
                "month_key": month_key,
                "rent_amount_paise": rent_paise,
                "rent_status": rent_status,
                "rent_paid_date": normalize_date_str(m.get("rent_paid_date")) if rent_status == "paid_success" else None,
                "electric_amount_paise": electric_paise,
                "electric_status": electric_status,
                "electric_paid_date": (
                    normalize_date_str(m.get("electric_paid_date")) if electric_status == "paid_success" else None
                ),
                "notes": str(m.get("notes") or ""),
                "extra_data": _extract_extra_json(m, known_month_keys),
                "client_mutation_id": m.get("client_mutation_id"),
            }
        )

    raw_history = raw_payload.get("rate_history") or []
    history_out: list[dict[str, Any]] = []
    if isinstance(raw_history, list):
        for h in raw_history:
            if not isinstance(h, dict):
                continue
            rate_paise = normalize_amount_to_paise(
                h.get("rent_amount_paise"),
                h.get("rent_amount"),
            )
            if rate_paise is None:
                continue
            history_out.append(
                {
                    "legacy_lease_id": h.get("lease_id"),
                    "rent_amount_paise": rate_paise,
                    "note": str(h.get("note") or "Restored rate entry")[:255],
                }
            )

    return {
        "schema_version": CURRENT_SCHEMA_VERSION,
        "settings": settings_out,
        "leases": leases_out,
        "months": months_out,
        "rate_history": history_out,
    }
