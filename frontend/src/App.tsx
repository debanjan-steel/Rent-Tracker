import { useCallback, useEffect, useState } from "react";
import {
  CalendarDays,
  Columns3,
  RefreshCw,
  Settings,
  ShieldCheck,
  Wifi,
  WifiOff,
  Home,
} from "lucide-react";
import type { DashboardResponse, MonthlyEntry } from "./types";
import {
  addMonth,
  deleteMonth,
  fetchDashboard,
  flushOfflineQueue,
  reopenSecurityDeposit,
  restoreBackupJson,
  returnSecurityDeposit,
  saveElectricBill,
  saveMonthNotes,
  saveSecurityDeposit,
  toggleElectricStatus,
  toggleRentStatus,
  updateLeaseDetails,
  updateRentRate,
} from "./lib/api";
import { clearDurableUserBackup, listQueuedMutations } from "./lib/offlineStore";
import { formatINR } from "./utils/format";
import { RentRateBanner } from "./components/RentRateBanner";
import { MonthlyLedgerView } from "./components/MonthlyLedgerView";
import { SecurityDepositPanel } from "./components/SecurityDepositPanel";
import { SettingsPanel } from "./components/SettingsPanel";

type AppTab = "columns" | "tabs" | "deposit" | "settings";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function App() {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("columns");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [fromCache, setFromCache] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [recoverableBackup, setRecoverableBackup] = useState<DashboardResponse | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetchDashboard();
      setDashboard(res.dashboard);
      setFromCache(res.fromCache);
      setPendingSyncCount(res.pendingCount);
      setRecoverableBackup(res.recoverableBackup);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rent tracker data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void (async () => {
        await flushOfflineQueue();
        await load();
      })();
    };
    const handleOffline = () => setIsOnline(false);
    const handleInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
    };
  }, [load]);

  const runAction = async <T extends { dashboard: DashboardResponse; queuedOffline: boolean }>(
    fn: () => Promise<T>,
  ): Promise<T | undefined> => {
    try {
      setBusy(true);
      setError(null);
      const result = await fn();
      setDashboard(result.dashboard);
      setFromCache(result.queuedOffline);
      const queued = await listQueuedMutations();
      setPendingSyncCount(queued.length);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm font-medium text-slate-600">
        Loading Rent &amp; Electric Tracker...
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 p-6 text-center">
        <p className="text-sm font-semibold text-rose-700">{error ?? "Unable to connect to backend."}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            void load();
          }}
          className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  const { active_lease, months, settings, summary } = dashboard;
  const dueRentCount = months.filter((m) => m.rent_status === "due_pending").length;
  const paidRentCount = months.filter((m) => m.rent_status === "paid_success").length;

  const navItems: { id: AppTab; label: string; icon: typeof Columns3 }[] = [
    { id: "columns", label: "Columns", icon: Columns3 },
    { id: "tabs", label: "Month Tabs", icon: CalendarDays },
    { id: "deposit", label: "Deposit", icon: ShieldCheck },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-slate-50 pb-24 sm:pb-10">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-700 text-white shadow-xs">
              <Home className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 sm:text-lg">Rent &amp; Electric Tracker</h1>
              <p className="text-xs text-slate-500">
                {active_lease.unit_label} &bull; {active_lease.tenant_name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {pendingSyncCount > 0 && isOnline && (
              <button
                type="button"
                onClick={() => {
                  void load();
                }}
                className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Sync ({pendingSyncCount})</span>
              </button>
            )}

            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                isOnline && !fromCache
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              {isOnline && !fromCache ? (
                <>
                  <Wifi className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Synced</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3.5 w-3.5" />
                  <span>{pendingSyncCount > 0 ? `Offline (${pendingSyncCount})` : "Offline"}</span>
                </>
              )}
            </span>
          </div>
        </div>

        {/* Desktop Tab Bar */}
        <div className="mx-auto hidden max-w-5xl gap-1 px-4 pb-2 sm:flex">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-teal-700 text-white shadow-xs"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-5xl space-y-5 px-4 pt-5">
        {recoverableBackup && (
          <div className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 shadow-xs sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-bold">Saved data found in this browser</p>
              <p className="text-xs text-amber-900">
                The server returned an empty ledger (such as after a fresh container deploy), so your saved browser snapshot is shown safely below.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    try {
                      setBusy(true);
                      const restored = await restoreBackupJson(recoverableBackup);
                      setDashboard(restored);
                      setRecoverableBackup(null);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Failed to restore backup.");
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
                className="inline-flex min-h-9 cursor-pointer items-center rounded-xl bg-amber-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-60"
              >
                Restore to Server
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    await clearDurableUserBackup();
                    setRecoverableBackup(null);
                    await load();
                  })();
                }}
                className="inline-flex min-h-9 cursor-pointer items-center rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
              >
                Start Fresh
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700">
            {error}
          </div>
        )}

        {/* Top-of-Page Rent Rate Control */}
        <RentRateBanner
          currentRentPaise={settings.default_rent_paise}
          dueMonthsCount={dueRentCount}
          paidMonthsCount={paidRentCount}
          busy={busy}
          onSaveRent={async (newRentPaise) => {
            await runAction(() => updateRentRate(dashboard, newRentPaise, "Updated from top bar"));
          }}
        />

        {/* Summary Cards */}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs">
            <div className="text-xs font-medium text-slate-500">Rent Due / Pending</div>
            <div className="mt-1 text-lg font-bold text-amber-700">
              {formatINR(summary.total_rent_due_paise)}
            </div>
            <div className="text-[11px] text-slate-400">{dueRentCount} unpaid month(s)</div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs">
            <div className="text-xs font-medium text-slate-500">Rent Paid / Success</div>
            <div className="mt-1 text-lg font-bold text-emerald-700">
              {formatINR(summary.total_rent_paid_paise)}
            </div>
            <div className="text-[11px] text-slate-400">{paidRentCount} paid month(s)</div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs">
            <div className="text-xs font-medium text-slate-500">Electric Due / Paid</div>
            <div className="mt-1 text-lg font-bold text-slate-900">
              {formatINR(summary.total_electric_due_paise)}
            </div>
            <div className="text-[11px] text-emerald-700">
              Paid: {formatINR(summary.total_electric_paid_paise)}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setActiveTab("deposit")}
            className="cursor-pointer rounded-2xl border border-slate-200 bg-white p-3.5 text-left shadow-xs transition hover:border-teal-300"
          >
            <div className="text-xs font-medium text-slate-500">Security Deposit</div>
            <div className="mt-1 text-lg font-bold text-teal-800">
              {formatINR(active_lease.security_deposit_paise)}
            </div>
            <div className="text-[11px] text-slate-500">
              {active_lease.deposit_status === "held" && "Held (Returnable at End)"}
              {active_lease.deposit_status === "returned" && "Returned"}
              {active_lease.deposit_status === "partially_returned" && "Partially Returned"}
              {active_lease.deposit_status === "not_set" && "Tap to set deposit"}
            </div>
          </button>
        </section>

        {/* Active Tab View */}
        {(activeTab === "columns" || activeTab === "tabs") && (
          <MonthlyLedgerView
            mode={activeTab}
            months={months}
            busy={busy}
            onAddMonth={async (monthKey) => {
              const res = await runAction(() => addMonth(dashboard, monthKey));
              if (!res) return undefined;
              const added = monthKey
                ? res.dashboard.months.find((m) => m.month_key === monthKey)
                : res.dashboard.months[res.dashboard.months.length - 1];
              return added;
            }}
            onDeleteMonth={async (monthId) => {
              await runAction(() => deleteMonth(dashboard, monthId));
            }}
            onToggleRent={async (entry: MonthlyEntry) => {
              await runAction(() => toggleRentStatus(dashboard, entry));
            }}
            onSaveElectricAmount={async (entry: MonthlyEntry, amountPaise: number | null) => {
              await runAction(() => saveElectricBill(dashboard, entry.id, amountPaise));
            }}
            onToggleElectric={async (entry: MonthlyEntry, draftPaise?: number | null) => {
              await runAction(() => toggleElectricStatus(dashboard, entry, draftPaise));
            }}
            onSaveNotes={async (monthId, notes) => {
              await runAction(() => saveMonthNotes(dashboard, monthId, notes));
            }}
          />
        )}

        {activeTab === "deposit" && (
          <SecurityDepositPanel
            lease={active_lease}
            busy={busy}
            onSaveDeposit={async (amountPaise, givenDate, notes) => {
              await runAction(() => saveSecurityDeposit(dashboard, amountPaise, givenDate, notes));
            }}
            onReturnDeposit={async (returnedPaise, returnedDate, endMonth, markEnded, notes) => {
              await runAction(() =>
                returnSecurityDeposit(
                  dashboard,
                  returnedPaise,
                  returnedDate,
                  endMonth,
                  markEnded,
                  notes,
                ),
              );
            }}
            onReopenDeposit={async () => {
              await runAction(() => reopenSecurityDeposit(dashboard));
            }}
          />
        )}

        {activeTab === "settings" && (
          <SettingsPanel
            dashboard={dashboard}
            busy={busy}
            canInstallPwa={installPrompt !== null}
            onInstallPwa={async () => {
              if (!installPrompt) return;
              await installPrompt.prompt();
              await installPrompt.userChoice;
              setInstallPrompt(null);
            }}
            onSaveRent={async (rentPaise, note) => {
              await runAction(() => updateRentRate(dashboard, rentPaise, note));
            }}
            onUpdateLease={async (tenantName, unitLabel, startMonth) => {
              await runAction(() => updateLeaseDetails(dashboard, tenantName, unitLabel, startMonth));
            }}
            onImportBackup={async (payload) => {
              const restored = await restoreBackupJson(payload);
              setDashboard(restored);
              setRecoverableBackup(null);
            }}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-slate-200 bg-white/95 backdrop-blur-sm sm:hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-semibold ${
                active ? "text-teal-700" : "text-slate-500"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default App;
