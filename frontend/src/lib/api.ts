import type { DashboardResponse, DashboardSummary, LeasePeriod, MonthlyEntry, RentStatus } from "../types";
import { makeMutationId, nextMonthKey, todayIso } from "../utils/format";
import {
  cacheDashboard,
  enqueueMutation,
  listQueuedMutations,
  loadCachedDashboard,
  removeMutation,
  type QueuedMutation,
} from "./offlineStore";

const API_BASE = "/api/v1";

function isNetworkFailure(err: unknown): boolean {
  if (!navigator.onLine) {
    return true;
  }
  return err instanceof TypeError;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!resp.ok) {
    let detail = `Request failed (${resp.status})`;
    try {
      const data = await resp.json();
      if (data?.detail) {
        detail = String(data.detail);
      }
    } catch {
      // Ignore parse failure
    }
    throw new Error(detail);
  }
  if (resp.status === 204) {
    return undefined as T;
  }
  return resp.json() as Promise<T>;
}

export function recomputeSummary(lease: LeasePeriod, months: MonthlyEntry[]): DashboardSummary {
  let totalRentDue = 0;
  let totalRentPaid = 0;
  let totalElectricDue = 0;
  let totalElectricPaid = 0;
  let dueMonths = 0;
  let paidMonths = 0;

  for (const m of months) {
    if (m.rent_status === "paid_success") {
      totalRentPaid += m.rent_amount_paise;
    } else {
      totalRentDue += m.rent_amount_paise;
    }

    if (m.electric_amount_paise !== null) {
      if (m.electric_status === "paid_success") {
        totalElectricPaid += m.electric_amount_paise;
      } else if (m.electric_status === "due_pending") {
        totalElectricDue += m.electric_amount_paise;
      }
    }

    if (m.rent_status === "due_pending" || m.electric_status === "due_pending") {
      dueMonths += 1;
    } else {
      paidMonths += 1;
    }
  }

  return {
    total_rent_due_paise: totalRentDue,
    total_rent_paid_paise: totalRentPaid,
    total_electric_due_paise: totalElectricDue,
    total_electric_paid_paise: totalElectricPaid,
    due_months_count: dueMonths,
    paid_months_count: paidMonths,
    security_deposit_held_paise: lease.deposit_status === "held" ? lease.security_deposit_paise : 0,
    security_deposit_returned_paise: lease.deposit_returned_paise ?? 0,
  };
}

function finalizeOfflineDashboard(
  dash: DashboardResponse,
  lease: LeasePeriod,
  months: MonthlyEntry[],
): DashboardResponse {
  const sortedMonths = [...months].sort((a, b) => a.month_key.localeCompare(b.month_key));
  const updated: DashboardResponse = {
    ...dash,
    active_lease: lease,
    leases: dash.leases.map((item) => (item.id === lease.id ? lease : item)),
    months: sortedMonths,
    summary: recomputeSummary(lease, sortedMonths),
  };
  return updated;
}

async function sendMutation(item: QueuedMutation, tempIdMap: Map<number, number>): Promise<void> {
  const resolveMonthId = (id: number) => tempIdMap.get(id) ?? id;

  switch (item.type) {
    case "set_rent_rate":
      await requestJson("/settings/rent", {
        method: "PUT",
        body: JSON.stringify({
          lease_id: item.leaseId,
          rent_amount_paise: item.rentAmountPaise,
          note: item.note,
        }),
      });
      return;
    case "add_month": {
      const created = await requestJson<MonthlyEntry>(`/leases/${item.leaseId}/months`, {
        method: "POST",
        body: JSON.stringify({
          month_key: item.monthKey,
          client_mutation_id: item.clientMutationId,
        }),
      });
      tempIdMap.set(item.tempMonthId, created.id);
      return;
    }
    case "delete_month": {
      const realId = resolveMonthId(item.monthId);
      if (realId > 0) {
        await requestJson(`/months/${realId}`, { method: "DELETE" });
      }
      return;
    }
    case "patch_electric": {
      const realId = resolveMonthId(item.monthId);
      await requestJson(`/months/${realId}/electric`, {
        method: "PATCH",
        body: JSON.stringify({
          electric_amount_paise: item.electricAmountPaise,
          client_mutation_id: item.clientMutationId,
        }),
      });
      return;
    }
    case "toggle_rent": {
      const realId = resolveMonthId(item.monthId);
      await requestJson(`/months/${realId}/rent/toggle`, {
        method: "POST",
        body: JSON.stringify({
          target_status: item.targetStatus,
          paid_date: item.paidDate,
          client_mutation_id: item.clientMutationId,
        }),
      });
      return;
    }
    case "toggle_electric": {
      const realId = resolveMonthId(item.monthId);
      await requestJson(`/months/${realId}/electric/toggle`, {
        method: "POST",
        body: JSON.stringify({
          target_status: item.targetStatus,
          paid_date: item.paidDate,
          client_mutation_id: item.clientMutationId,
        }),
      });
      return;
    }
    case "patch_notes": {
      const realId = resolveMonthId(item.monthId);
      await requestJson(`/months/${realId}/notes`, {
        method: "PATCH",
        body: JSON.stringify({ notes: item.notes }),
      });
      return;
    }
    case "update_deposit":
      await requestJson(`/leases/${item.leaseId}/deposit`, {
        method: "PUT",
        body: JSON.stringify({
          security_deposit_paise: item.securityDepositPaise,
          deposit_given_date: item.depositGivenDate,
          deposit_notes: item.depositNotes,
        }),
      });
      return;
    case "return_deposit":
      await requestJson(`/leases/${item.leaseId}/deposit/return`, {
        method: "POST",
        body: JSON.stringify({
          deposit_returned_paise: item.depositReturnedPaise,
          deposit_returned_date: item.depositReturnedDate,
          end_month: item.endMonth,
          mark_lease_ended: item.markLeaseEnded,
          deposit_notes: item.depositNotes,
        }),
      });
      return;
    case "reopen_deposit":
      await requestJson(`/leases/${item.leaseId}/deposit/reopen`, {
        method: "POST",
      });
      return;
    case "update_lease":
      await requestJson(`/leases/${item.leaseId}`, {
        method: "PUT",
        body: JSON.stringify({
          tenant_name: item.tenantName,
          unit_label: item.unitLabel,
          start_month: item.startMonth,
        }),
      });
      return;
  }
}

export async function flushOfflineQueue(): Promise<{ synced: number; remaining: number }> {
  const queue = await listQueuedMutations();
  if (queue.length === 0) {
    return { synced: 0, remaining: 0 };
  }

  const tempIdMap = new Map<number, number>();
  let synced = 0;
  for (const item of queue) {
    try {
      await sendMutation(item, tempIdMap);
      await removeMutation(item.id);
      synced += 1;
    } catch (err) {
      if (isNetworkFailure(err)) {
        break;
      }
      // Drop permanently invalid queued item so queue never stalls indefinitely
      await removeMutation(item.id);
    }
  }
  const remaining = (await listQueuedMutations()).length;
  return { synced, remaining };
}

export async function fetchDashboard(leaseId?: number): Promise<{
  dashboard: DashboardResponse;
  fromCache: boolean;
  pendingCount: number;
}> {
  try {
    const { remaining } = await flushOfflineQueue();
    const query = leaseId ? `?lease_id=${leaseId}` : "";
    const dashboard = await requestJson<DashboardResponse>(`/dashboard${query}`);
    await cacheDashboard(dashboard);
    return { dashboard, fromCache: false, pendingCount: remaining };
  } catch (err) {
    const cached = await loadCachedDashboard();
    const pendingCount = (await listQueuedMutations()).length;
    if (cached) {
      return { dashboard: cached, fromCache: true, pendingCount };
    }
    throw err;
  }
}

export async function executeWithOfflineFallback(
  current: DashboardResponse,
  mutation: QueuedMutation,
  applyOptimistic: (dash: DashboardResponse) => DashboardResponse,
): Promise<{ dashboard: DashboardResponse; queuedOffline: boolean }> {
  const optimistic = applyOptimistic(current);
  await cacheDashboard(optimistic);

  try {
    await flushOfflineQueue();
    await sendMutation(mutation, new Map<number, number>());
    const fresh = await requestJson<DashboardResponse>(`/dashboard?lease_id=${current.active_lease.id}`);
    await cacheDashboard(fresh);
    return { dashboard: fresh, queuedOffline: false };
  } catch (err) {
    if (!isNetworkFailure(err)) {
      throw err;
    }
    await enqueueMutation(mutation);
    return { dashboard: optimistic, queuedOffline: true };
  }
}

export async function updateRentRate(
  current: DashboardResponse,
  rentAmountPaise: number,
  note = "Updated rent rate",
) {
  const nowIso = new Date().toISOString();
  const mutation: QueuedMutation = {
    id: makeMutationId(),
    createdAt: Date.now(),
    type: "set_rent_rate",
    leaseId: current.active_lease.id,
    rentAmountPaise,
    note,
  };
  return executeWithOfflineFallback(current, mutation, (dash) => {
    const months = dash.months.map((m) =>
      m.rent_status === "due_pending"
        ? { ...m, rent_amount_paise: rentAmountPaise, updated_at: nowIso }
        : m,
    );
    const updated = finalizeOfflineDashboard(dash, dash.active_lease, months);
    return {
      ...updated,
      settings: { ...dash.settings, default_rent_paise: rentAmountPaise, updated_at: nowIso },
      rate_history: [
        {
          id: -Date.now(),
          lease_id: dash.active_lease.id,
          rent_amount_paise: rentAmountPaise,
          note,
          created_at: nowIso,
        },
        ...dash.rate_history,
      ],
    };
  });
}

export async function addMonth(current: DashboardResponse, explicitMonthKey?: string) {
  const latest = current.months[current.months.length - 1];
  const monthKey = explicitMonthKey || (latest ? nextMonthKey(latest.month_key) : current.active_lease.start_month);
  if (current.months.some((m) => m.month_key === monthKey)) {
    throw new Error(`Month ${monthKey} already exists.`);
  }
  const nowIso = new Date().toISOString();
  const tempMonthId = -Date.now();
  const clientMutationId = makeMutationId();
  const mutation: QueuedMutation = {
    id: makeMutationId(),
    createdAt: Date.now(),
    type: "add_month",
    leaseId: current.active_lease.id,
    tempMonthId,
    monthKey,
    clientMutationId,
  };
  return executeWithOfflineFallback(current, mutation, (dash) => {
    const newEntry: MonthlyEntry = {
      id: tempMonthId,
      lease_id: dash.active_lease.id,
      month_key: monthKey,
      rent_amount_paise: dash.settings.default_rent_paise,
      rent_status: "due_pending",
      rent_paid_date: null,
      electric_amount_paise: null,
      electric_status: "blank",
      electric_paid_date: null,
      notes: "",
      client_mutation_id: clientMutationId,
      created_at: nowIso,
      updated_at: nowIso,
    };
    return finalizeOfflineDashboard(dash, dash.active_lease, [...dash.months, newEntry]);
  });
}

export async function deleteMonth(current: DashboardResponse, monthId: number) {
  const mutation: QueuedMutation = {
    id: makeMutationId(),
    createdAt: Date.now(),
    type: "delete_month",
    monthId,
  };
  return executeWithOfflineFallback(current, mutation, (dash) => {
    const months = dash.months.filter((m) => m.id !== monthId);
    return finalizeOfflineDashboard(dash, dash.active_lease, months);
  });
}

export async function saveElectricBill(
  current: DashboardResponse,
  monthId: number,
  electricAmountPaise: number | null,
) {
  const nowIso = new Date().toISOString();
  const clientMutationId = makeMutationId();
  const mutation: QueuedMutation = {
    id: makeMutationId(),
    createdAt: Date.now(),
    type: "patch_electric",
    monthId,
    electricAmountPaise,
    clientMutationId,
  };
  return executeWithOfflineFallback(current, mutation, (dash) => {
    const months = dash.months.map((m) => {
      if (m.id !== monthId) return m;
      if (electricAmountPaise === null) {
        return {
          ...m,
          electric_amount_paise: null,
          electric_status: "blank" as const,
          electric_paid_date: null,
          updated_at: nowIso,
        };
      }
      return {
        ...m,
        electric_amount_paise: electricAmountPaise,
        electric_status: m.electric_status === "blank" ? ("due_pending" as const) : m.electric_status,
        updated_at: nowIso,
      };
    });
    return finalizeOfflineDashboard(dash, dash.active_lease, months);
  });
}

export async function toggleRentStatus(current: DashboardResponse, entry: MonthlyEntry) {
  const targetStatus: RentStatus = entry.rent_status === "due_pending" ? "paid_success" : "due_pending";
  const paidDate = targetStatus === "paid_success" ? todayIso() : null;
  const nowIso = new Date().toISOString();
  const clientMutationId = makeMutationId();
  const mutation: QueuedMutation = {
    id: makeMutationId(),
    createdAt: Date.now(),
    type: "toggle_rent",
    monthId: entry.id,
    targetStatus,
    paidDate,
    clientMutationId,
  };
  return executeWithOfflineFallback(current, mutation, (dash) => {
    const months = dash.months.map((m) =>
      m.id === entry.id
        ? { ...m, rent_status: targetStatus, rent_paid_date: paidDate, updated_at: nowIso }
        : m,
    );
    return finalizeOfflineDashboard(dash, dash.active_lease, months);
  });
}

export async function toggleElectricStatus(
  current: DashboardResponse,
  entry: MonthlyEntry,
  draftElectricPaise?: number | null,
) {
  let baseDashboard = current;
  let workingEntry = entry;

  // If user typed a bill amount right next to the button and immediately clicked Due/Pending, save it first!
  if (
    draftElectricPaise !== undefined &&
    draftElectricPaise !== null &&
    draftElectricPaise !== entry.electric_amount_paise
  ) {
    const saved = await saveElectricBill(current, entry.id, draftElectricPaise);
    baseDashboard = saved.dashboard;
    workingEntry = baseDashboard.months.find((m) => m.id === entry.id) ?? {
      ...entry,
      electric_amount_paise: draftElectricPaise,
      electric_status: "due_pending",
    };
  }

  if (workingEntry.electric_amount_paise === null) {
    throw new Error("Enter an electric bill amount before marking it paid.");
  }

  const targetStatus: RentStatus = workingEntry.electric_status === "due_pending" ? "paid_success" : "due_pending";
  const paidDate = targetStatus === "paid_success" ? todayIso() : null;
  const nowIso = new Date().toISOString();
  const clientMutationId = makeMutationId();
  const mutation: QueuedMutation = {
    id: makeMutationId(),
    createdAt: Date.now(),
    type: "toggle_electric",
    monthId: workingEntry.id,
    targetStatus,
    paidDate,
    clientMutationId,
  };
  return executeWithOfflineFallback(baseDashboard, mutation, (dash) => {
    const months = dash.months.map((m) =>
      m.id === workingEntry.id
        ? { ...m, electric_status: targetStatus, electric_paid_date: paidDate, updated_at: nowIso }
        : m,
    );
    return finalizeOfflineDashboard(dash, dash.active_lease, months);
  });
}

export async function saveMonthNotes(current: DashboardResponse, monthId: number, notes: string) {
  const nowIso = new Date().toISOString();
  const mutation: QueuedMutation = {
    id: makeMutationId(),
    createdAt: Date.now(),
    type: "patch_notes",
    monthId,
    notes,
  };
  return executeWithOfflineFallback(current, mutation, (dash) => {
    const months = dash.months.map((m) =>
      m.id === monthId ? { ...m, notes, updated_at: nowIso } : m,
    );
    return finalizeOfflineDashboard(dash, dash.active_lease, months);
  });
}

export async function saveSecurityDeposit(
  current: DashboardResponse,
  securityDepositPaise: number,
  depositGivenDate: string | null,
  depositNotes: string,
) {
  const nowIso = new Date().toISOString();
  const mutation: QueuedMutation = {
    id: makeMutationId(),
    createdAt: Date.now(),
    type: "update_deposit",
    leaseId: current.active_lease.id,
    securityDepositPaise,
    depositGivenDate,
    depositNotes,
  };
  return executeWithOfflineFallback(current, mutation, (dash) => {
    const lease: LeasePeriod = {
      ...dash.active_lease,
      security_deposit_paise: securityDepositPaise,
      deposit_given_date: depositGivenDate,
      deposit_notes: depositNotes,
      deposit_status:
        securityDepositPaise === 0
          ? "not_set"
          : dash.active_lease.deposit_status === "not_set"
            ? "held"
            : dash.active_lease.deposit_status,
      deposit_returned_paise: securityDepositPaise === 0 ? null : dash.active_lease.deposit_returned_paise,
      deposit_returned_date: securityDepositPaise === 0 ? null : dash.active_lease.deposit_returned_date,
      updated_at: nowIso,
    };
    return finalizeOfflineDashboard(dash, lease, dash.months);
  });
}

export async function returnSecurityDeposit(
  current: DashboardResponse,
  depositReturnedPaise: number,
  depositReturnedDate: string | null,
  endMonth: string | null,
  markLeaseEnded: boolean,
  depositNotes: string,
) {
  const nowIso = new Date().toISOString();
  const mutation: QueuedMutation = {
    id: makeMutationId(),
    createdAt: Date.now(),
    type: "return_deposit",
    leaseId: current.active_lease.id,
    depositReturnedPaise,
    depositReturnedDate,
    endMonth,
    markLeaseEnded,
    depositNotes,
  };
  return executeWithOfflineFallback(current, mutation, (dash) => {
    const held = dash.active_lease.security_deposit_paise;
    const lease: LeasePeriod = {
      ...dash.active_lease,
      deposit_returned_paise: depositReturnedPaise,
      deposit_returned_date: depositReturnedDate || todayIso(),
      deposit_status: depositReturnedPaise === held ? "returned" : "partially_returned",
      end_month: endMonth ?? dash.active_lease.end_month,
      status: markLeaseEnded ? "ended" : dash.active_lease.status,
      deposit_notes: depositNotes || dash.active_lease.deposit_notes,
      updated_at: nowIso,
    };
    return finalizeOfflineDashboard(dash, lease, dash.months);
  });
}

export async function reopenSecurityDeposit(current: DashboardResponse) {
  const nowIso = new Date().toISOString();
  const mutation: QueuedMutation = {
    id: makeMutationId(),
    createdAt: Date.now(),
    type: "reopen_deposit",
    leaseId: current.active_lease.id,
  };
  return executeWithOfflineFallback(current, mutation, (dash) => {
    const lease: LeasePeriod = {
      ...dash.active_lease,
      deposit_status: dash.active_lease.security_deposit_paise > 0 ? "held" : "not_set",
      deposit_returned_paise: null,
      deposit_returned_date: null,
      status: "active",
      updated_at: nowIso,
    };
    return finalizeOfflineDashboard(dash, lease, dash.months);
  });
}

export async function updateLeaseDetails(
  current: DashboardResponse,
  tenantName: string,
  unitLabel: string,
  startMonth: string,
) {
  const nowIso = new Date().toISOString();
  const mutation: QueuedMutation = {
    id: makeMutationId(),
    createdAt: Date.now(),
    type: "update_lease",
    leaseId: current.active_lease.id,
    tenantName,
    unitLabel,
    startMonth,
  };
  return executeWithOfflineFallback(current, mutation, (dash) => {
    const lease: LeasePeriod = {
      ...dash.active_lease,
      tenant_name: tenantName,
      unit_label: unitLabel,
      start_month: startMonth,
      updated_at: nowIso,
    };
    return finalizeOfflineDashboard(dash, lease, dash.months);
  });
}
