export type RentStatus = "due_pending" | "paid_success";
export type ElectricStatus = "blank" | "due_pending" | "paid_success";
export type DepositStatus = "not_set" | "held" | "returned" | "partially_returned";
export type LeaseStatus = "active" | "ended";

export interface AppSettings {
  id: number;
  currency: string;
  default_rent_paise: number;
  updated_at: string;
}

export interface RentRateHistoryItem {
  id: number;
  lease_id: number;
  rent_amount_paise: number;
  note: string;
  created_at: string;
}

export interface LeasePeriod {
  id: number;
  tenant_name: string;
  unit_label: string;
  start_month: string;
  end_month: string | null;
  status: LeaseStatus;
  security_deposit_paise: number;
  deposit_given_date: string | null;
  deposit_status: DepositStatus;
  deposit_returned_paise: number | null;
  deposit_returned_date: string | null;
  deposit_notes: string;
  created_at: string;
  updated_at: string;
}

export interface MonthlyEntry {
  id: number;
  lease_id: number;
  month_key: string;
  rent_amount_paise: number;
  rent_status: RentStatus;
  rent_paid_date: string | null;
  electric_amount_paise: number | null;
  electric_status: ElectricStatus;
  electric_paid_date: string | null;
  notes: string;
  client_mutation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardSummary {
  total_rent_due_paise: number;
  total_rent_paid_paise: number;
  total_electric_due_paise: number;
  total_electric_paid_paise: number;
  due_months_count: number;
  paid_months_count: number;
  security_deposit_held_paise: number;
  security_deposit_returned_paise: number;
}

export interface DashboardResponse {
  settings: AppSettings;
  active_lease: LeasePeriod;
  leases: LeasePeriod[];
  months: MonthlyEntry[];
  rate_history: RentRateHistoryItem[];
  summary: DashboardSummary;
}
