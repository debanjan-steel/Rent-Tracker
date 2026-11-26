"""SQLAlchemy ORM models for the manual-first Rent & Electric Bill Tracker."""

from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utc_now() -> datetime:
    """Return timezone-aware UTC timestamp."""
    return datetime.now(UTC)


class SchemaMeta(Base):
    """Tracks applied database schema version for safe forward migrations."""

    __tablename__ = "schema_meta"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class AppSettings(Base):
    """Global app preferences including current base monthly rent."""

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="INR")
    default_rent_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class LeasePeriod(Base):
    """Tenancy / renting period record (single-tenant now, multi-tenant ready)."""

    __tablename__ = "lease_periods"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_name: Mapped[str] = mapped_column(String(120), nullable=False, default="Primary Tenant")
    unit_label: Mapped[str] = mapped_column(String(120), nullable=False, default="Rental Unit")
    start_month: Mapped[str] = mapped_column(String(7), nullable=False)
    end_month: Mapped[str | None] = mapped_column(String(7), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")

    security_deposit_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deposit_given_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    deposit_status: Mapped[str] = mapped_column(String(24), nullable=False, default="not_set")
    deposit_returned_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    deposit_returned_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    deposit_notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    extra_data: Mapped[str] = mapped_column(Text, nullable=False, default="{}")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    months: Mapped[list["MonthlyEntry"]] = relationship(
        back_populates="lease", cascade="all, delete-orphan", order_by="MonthlyEntry.month_key"
    )
    rate_history: Mapped[list["RentRateHistory"]] = relationship(
        back_populates="lease", cascade="all, delete-orphan", order_by="RentRateHistory.id.desc()"
    )


class RentRateHistory(Base):
    """Audit log of rent changes made from Settings or top-of-page control."""

    __tablename__ = "rent_rate_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lease_id: Mapped[int] = mapped_column(ForeignKey("lease_periods.id", ondelete="CASCADE"), nullable=False)
    rent_amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    lease: Mapped["LeasePeriod"] = relationship(back_populates="rate_history")


class MonthlyEntry(Base):
    """Monthly ledger row tracking Rent and Electric Bill manually."""

    __tablename__ = "monthly_entries"
    __table_args__ = (UniqueConstraint("lease_id", "month_key", name="uq_lease_month"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lease_id: Mapped[int] = mapped_column(ForeignKey("lease_periods.id", ondelete="CASCADE"), nullable=False)
    month_key: Mapped[str] = mapped_column(String(7), nullable=False)

    rent_amount_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rent_status: Mapped[str] = mapped_column(String(20), nullable=False, default="due_pending")
    rent_paid_date: Mapped[str | None] = mapped_column(String(10), nullable=True)

    electric_amount_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    electric_status: Mapped[str] = mapped_column(String(20), nullable=False, default="blank")
    electric_paid_date: Mapped[str | None] = mapped_column(String(10), nullable=True)

    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    extra_data: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    client_mutation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    lease: Mapped["LeasePeriod"] = relationship(back_populates="months")
