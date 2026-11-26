import type { DashboardResponse } from "../types";

const DB_NAME = "rent-tracker-pwa-db";
const DB_VERSION = 1;
const STORE_STATE = "stateCache";
const STORE_QUEUE = "mutationQueue";
const DASHBOARD_KEY = "dashboard";
const DURABLE_BACKUP_KEY = "durableUserBackup";

export function hasRealUserData(dash: DashboardResponse): boolean {
  if (dash.settings.default_rent_paise > 0) return true;
  if (dash.active_lease.security_deposit_paise > 0) return true;
  if (dash.active_lease.tenant_name !== "Primary Tenant") return true;
  if (dash.active_lease.unit_label !== "Rental Unit") return true;
  if (dash.leases.length > 1) return true;
  return dash.months.some(
    (m) =>
      m.rent_status === "paid_success" ||
      m.electric_amount_paise !== null ||
      m.notes.trim() !== "",
  );
}

export type QueuedMutation =
  | {
      id: string;
      createdAt: number;
      type: "set_rent_rate";
      leaseId: number;
      rentAmountPaise: number;
      note: string;
    }
  | {
      id: string;
      createdAt: number;
      type: "add_month";
      leaseId: number;
      tempMonthId: number;
      monthKey: string;
      clientMutationId: string;
    }
  | {
      id: string;
      createdAt: number;
      type: "delete_month";
      monthId: number;
    }
  | {
      id: string;
      createdAt: number;
      type: "patch_electric";
      monthId: number;
      electricAmountPaise: number | null;
      clientMutationId: string;
    }
  | {
      id: string;
      createdAt: number;
      type: "toggle_rent";
      monthId: number;
      targetStatus: "due_pending" | "paid_success";
      paidDate: string | null;
      clientMutationId: string;
    }
  | {
      id: string;
      createdAt: number;
      type: "toggle_electric";
      monthId: number;
      targetStatus: "due_pending" | "paid_success";
      paidDate: string | null;
      clientMutationId: string;
    }
  | {
      id: string;
      createdAt: number;
      type: "patch_notes";
      monthId: number;
      notes: string;
    }
  | {
      id: string;
      createdAt: number;
      type: "update_deposit";
      leaseId: number;
      securityDepositPaise: number;
      depositGivenDate: string | null;
      depositNotes: string;
    }
  | {
      id: string;
      createdAt: number;
      type: "return_deposit";
      leaseId: number;
      depositReturnedPaise: number;
      depositReturnedDate: string | null;
      endMonth: string | null;
      markLeaseEnded: boolean;
      depositNotes: string;
    }
  | {
      id: string;
      createdAt: number;
      type: "reopen_deposit";
      leaseId: number;
    }
  | {
      id: string;
      createdAt: number;
      type: "update_lease";
      leaseId: number;
      tenantName: string;
      unitLabel: string;
      startMonth: string;
    };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_STATE)) {
        db.createObjectStore(STORE_STATE);
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheDashboard(dashboard: DashboardResponse): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_STATE, "readwrite");
      const store = tx.objectStore(STORE_STATE);
      store.put(dashboard, DASHBOARD_KEY);
      if (hasRealUserData(dashboard)) {
        store.put(dashboard, DURABLE_BACKUP_KEY);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Best-effort cache write
  }
}

export async function loadCachedDashboard(): Promise<DashboardResponse | null> {
  try {
    const db = await openDb();
    const result = await new Promise<DashboardResponse | null>((resolve, reject) => {
      const tx = db.transaction(STORE_STATE, "readonly");
      const req = tx.objectStore(STORE_STATE).get(DASHBOARD_KEY);
      req.onsuccess = () => resolve((req.result as DashboardResponse | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function loadDurableUserBackup(): Promise<DashboardResponse | null> {
  try {
    const db = await openDb();
    const result = await new Promise<DashboardResponse | null>((resolve, reject) => {
      const tx = db.transaction(STORE_STATE, "readonly");
      const req = tx.objectStore(STORE_STATE).get(DURABLE_BACKUP_KEY);
      req.onsuccess = () => resolve((req.result as DashboardResponse | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function clearDurableUserBackup(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_STATE, "readwrite");
      tx.objectStore(STORE_STATE).delete(DURABLE_BACKUP_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Best-effort clear
  }
}

export async function clearAllOfflineData(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_STATE, STORE_QUEUE], "readwrite");
      tx.objectStore(STORE_STATE).clear();
      tx.objectStore(STORE_QUEUE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Best-effort clear
  }
}

export async function enqueueMutation(item: QueuedMutation): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, "readwrite");
    tx.objectStore(STORE_QUEUE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listQueuedMutations(): Promise<QueuedMutation[]> {
  try {
    const db = await openDb();
    const items = await new Promise<QueuedMutation[]>((resolve, reject) => {
      const tx = db.transaction(STORE_QUEUE, "readonly");
      const req = tx.objectStore(STORE_QUEUE).getAll();
      req.onsuccess = () => resolve((req.result as QueuedMutation[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return items.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function removeMutation(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, "readwrite");
    tx.objectStore(STORE_QUEUE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
