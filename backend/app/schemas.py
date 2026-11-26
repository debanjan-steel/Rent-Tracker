"""Pydantic v2 request and response schemas for the Rent Tracker API."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

MonthKey = Annotated[str, StringConstraints(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]
IsoDate = Annotated[str, StringConstraints(pattern=r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$")]

RentStatus = Literal["due_pending", "paid_success"]
ElectricStatus = Literal["blank", "due_pending", "paid_success"]
DepositStatus = Literal["not_set", "held", "returned", "partially_returned"]
LeaseStatus = Literal["active", "ended"]


class AppSettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    currency: str
    default_rent_paise: int
    updated_at: datetime


class RentRateUpdateRequest(BaseModel):
    rent_amount_paise: int = Field(ge=0)
    lease_id: int | None = None
    note: str = Field(default="", max_length=255)


class RentRateUpdateResponse(BaseModel):
    settings: AppSettingsRead
    updated_due_months_count: int
    rate_history_entry: "RentRateHistoryRead"


class RentRateHistoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    lease_id: int
    rent_amount_paise: int
    note: str
    created_at: datetime


class LeasePeriodCreate(BaseModel):
    tenant_name: str = Field(min_length=1, max_length=120)
    unit_label: str = Field(min_length=1, max_length=120)
    start_month: MonthKey
    security_deposit_paise: int = Field(default=0, ge=0)
    deposit_given_date: IsoDate | None = None
    deposit_notes: str = ""


class LeasePeriodUpdate(BaseModel):
    tenant_name: str | None = Field(default=None, min_length=1, max_length=120)
    unit_label: str | None = Field(default=None, min_length=1, max_length=120)
    start_month: MonthKey | None = None
    end_month: MonthKey | None = None
    status: LeaseStatus | None = None


class DepositUpdateRequest(BaseModel):
    security_deposit_paise: int = Field(ge=0)
    deposit_given_date: IsoDate | None = None
    deposit_notes: str = ""


class DepositReturnRequest(BaseModel):
    deposit_returned_paise: int = Field(ge=0)
    deposit_returned_date: IsoDate | None = None
    end_month: MonthKey | None = None
    mark_lease_ended: bool = True
    deposit_notes: str = ""


class LeasePeriodRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    tenant_name: str
    unit_label: str
    start_month: str
    end_month: str | None
    status: LeaseStatus
    security_deposit_paise: int
    deposit_given_date: str | None
    deposit_status: DepositStatus
    deposit_returned_paise: int | None
    deposit_returned_date: str | None
    deposit_notes: str
    created_at: datetime
    updated_at: datetime


class MonthCreateRequest(BaseModel):
    month_key: MonthKey | None = None
    notes: str = ""
    client_mutation_id: str | None = Field(default=None, max_length=64)


class ElectricUpdateRequest(BaseModel):
    electric_amount_paise: int | None = Field(default=None, ge=0)
    notes: str | None = None
    client_mutation_id: str | None = Field(default=None, max_length=64)


class StatusToggleRequest(BaseModel):
    target_status: RentStatus | None = None
    paid_date: IsoDate | None = None
    client_mutation_id: str | None = Field(default=None, max_length=64)


class MonthNotesUpdateRequest(BaseModel):
    notes: str = ""


class MonthlyEntryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    lease_id: int
    month_key: str
    rent_amount_paise: int
    rent_status: RentStatus
    rent_paid_date: str | None
    electric_amount_paise: int | None
    electric_status: ElectricStatus
    electric_paid_date: str | None
    notes: str
    client_mutation_id: str | None
    created_at: datetime
    updated_at: datetime


class DashboardSummary(BaseModel):
    total_rent_due_paise: int
    total_rent_paid_paise: int
    total_electric_due_paise: int
    total_electric_paid_paise: int
    due_months_count: int
    paid_months_count: int
    security_deposit_held_paise: int
    security_deposit_returned_paise: int


class DashboardResponse(BaseModel):
    settings: AppSettingsRead
    active_lease: LeasePeriodRead
    leases: list[LeasePeriodRead]
    months: list[MonthlyEntryRead]
    rate_history: list[RentRateHistoryRead]
    summary: DashboardSummary
