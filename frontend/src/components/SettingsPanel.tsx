import { useEffect, useRef, useState } from "react";
import { Download, History, Smartphone, Check, Upload, DatabaseZap, Trash2 } from "lucide-react";
import type { DashboardResponse } from "../types";
import { formatINR, paiseToInput, rupeesInputToPaise } from "../utils/format";

interface SettingsPanelProps {
  dashboard: DashboardResponse;
  busy: boolean;
  canInstallPwa: boolean;
  onInstallPwa: () => Promise<void>;
  onSaveRent: (rentPaise: number, note?: string) => Promise<void>;
  onUpdateLease: (tenantName: string, unitLabel: string, startMonth: string) => Promise<void>;
  onImportBackup: (payload: unknown) => Promise<void>;
  onDeleteEntireHistory: () => Promise<void>;
}

export function SettingsPanel({
  dashboard,
  busy,
  canInstallPwa,
  onInstallPwa,
  onSaveRent,
  onUpdateLease,
  onImportBackup,
  onDeleteEntireHistory,
}: SettingsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const { settings, active_lease, rate_history, summary } = dashboard;
  const [rentDraft, setRentDraft] = useState(() => paiseToInput(settings.default_rent_paise));
  const [rentNote, setRentNote] = useState("");
  const [tenantName, setTenantName] = useState(active_lease.tenant_name);
  const [unitLabel, setUnitLabel] = useState(active_lease.unit_label);
  const [startMonth, setStartMonth] = useState(active_lease.start_month);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    setRentDraft(settings.default_rent_paise === 0 ? "" : paiseToInput(settings.default_rent_paise));
  }, [settings.default_rent_paise]);

  useEffect(() => {
    setTenantName(active_lease.tenant_name);
    setUnitLabel(active_lease.unit_label);
    setStartMonth(active_lease.start_month);
  }, [active_lease]);

  const handleSaveRent = async (e: React.FormEvent) => {
    e.preventDefault();
    const paise = rupeesInputToPaise(rentDraft);
    if (paise === null) return;
    await onSaveRent(paise, rentNote.trim() || "Updated in Settings");
    setRentNote("");
    setSavedNotice("Rent updated for all Due / Pending months.");
    setTimeout(() => setSavedNotice(null), 3000);
  };

  const handleSaveLease = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantName.trim() || !unitLabel.trim()) return;
    await onUpdateLease(tenantName.trim(), unitLabel.trim(), startMonth);
    setSavedNotice("Tenant & unit details saved.");
    setTimeout(() => setSavedNotice(null), 3000);
  };

  const handleDownloadJson = () => {
    const blob = new Blob([JSON.stringify(dashboard, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rent-tracker-backup-${active_lease.start_month}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      await onImportBackup(parsed);
      setSavedNotice("Backup imported and migrated to current format.");
      setTimeout(() => setSavedNotice(null), 4000);
    } catch (err) {
      setSavedNotice(
        err instanceof Error ? `Import failed: ${err.message}` : "Import failed: invalid JSON file.",
      );
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="space-y-5">
      {savedNotice && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800">
          <Check className="h-4 w-4" />
          <span>{savedNotice}</span>
        </div>
      )}

      {/* Monthly Rent Rate Setting */}
      <form
        onSubmit={handleSaveRent}
        className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
      >
        <div>
          <h3 className="text-base font-bold text-slate-900">Monthly Rent Setting (INR)</h3>
          <p className="mt-1 text-xs text-slate-500">
            Changing this updates all{" "}
            <strong className="text-amber-700">{summary.due_months_count} Due / Pending</strong>{" "}
            months from the due month onward. Previously{" "}
            <strong className="text-emerald-700">{summary.paid_months_count} Paid / Success</strong>{" "}
            months remain unchanged.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-600" htmlFor="settings-rent-input">
              Monthly Rent Amount (₹)
            </label>
            <input
              id="settings-rent-input"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={rentDraft}
              onChange={(e) => setRentDraft(e.target.value)}
              placeholder="e.g. 12000"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:border-teal-600"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-600" htmlFor="settings-rent-note">
              Change Note (optional)
            </label>
            <input
              id="settings-rent-note"
              type="text"
              value={rentNote}
              onChange={(e) => setRentNote(e.target.value)}
              placeholder="e.g. Annual rent revision"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-600"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-10 cursor-pointer items-center rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
        >
          Update Monthly Rent
        </button>
      </form>

      {/* Tenant & Unit Info (Single-Tenant MVP, Multi-Tenant Ready) */}
      <form
        onSubmit={handleSaveLease}
        className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
      >
        <div>
          <h3 className="text-base font-bold text-slate-900">Tenant &amp; Unit Details</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Currently tracking a single tenant/unit; schema is ready for multiple tenants later.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-600" htmlFor="tenant-name">
              Tenant Name
            </label>
            <input
              id="tenant-name"
              type="text"
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-600"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-600" htmlFor="unit-label">
              Unit / House Name
            </label>
            <input
              id="unit-label"
              type="text"
              value={unitLabel}
              onChange={(e) => setUnitLabel(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-600"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-600" htmlFor="start-month">
              Lease Start Month
            </label>
            <input
              id="start-month"
              type="month"
              value={startMonth}
              onChange={(e) => setStartMonth(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-600"
            />
            <p className="text-[11px] text-slate-400">
              Setting an earlier start month automatically adds any missing months.
            </p>
          </div>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-slate-200 bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          Save Unit Details
        </button>
      </form>

      {/* PWA Install & Exports */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Smartphone className="h-4 w-4 text-teal-700" />
            <span>Install as App (PWA)</span>
          </div>
          <p className="text-xs text-slate-500">
            Install on Android, Windows, macOS, or iPhone Home Screen (Share &rarr; Add to Home Screen on iOS) for instant launch and offline support.
          </p>
          {canInstallPwa && (
            <button
              type="button"
              onClick={() => {
                void onInstallPwa();
              }}
              className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
            >
              <Smartphone className="h-4 w-4" />
              <span>Install App Now</span>
            </button>
          )}
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Download className="h-4 w-4 text-teal-700" />
            <span>Export, Backup &amp; Format-Safe Restore</span>
          </div>
          <p className="text-xs text-slate-500">
            Download records anytime. Restoring a JSON backup automatically upgrades older or changed input formats without deleting entries.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/v1/export/csv?lease_id=${active_lease.id}`}
              download="rent-ledger.csv"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
            >
              <Download className="h-4 w-4" />
              <span>CSV Ledger</span>
            </a>
            <button
              type="button"
              onClick={handleDownloadJson}
              className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
            >
              <Download className="h-4 w-4" />
              <span>JSON Backup</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                void handleFileImport(e);
              }}
              className="hidden"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-60"
            >
              <Upload className="h-4 w-4" />
              <span>Restore JSON</span>
            </button>
          </div>
          <div className="flex items-start gap-2 rounded-xl bg-slate-50 p-2.5 text-[11px] text-slate-500">
            <DatabaseZap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-700" />
            <span>
              Schema v{dashboard.schema_version ?? 2}: your browser keeps a durable backup snapshot automatically, and setting <code>RENT_TRACKER_DB_URL</code> to a PostgreSQL URL preserves data across cloud container rebuilds.
            </span>
          </div>
        </div>
      </div>

      {/* Rent Rate Change History */}
      {rate_history.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
            <History className="h-4 w-4 text-slate-500" />
            <span>Rent Rate Change Log</span>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {rate_history.map((item) => (
              <li key={item.id} className="flex items-center justify-between py-2">
                <div>
                  <span className="font-semibold text-slate-900">
                    {formatINR(item.rent_amount_paise)}
                  </span>
                  <span className="ml-2 text-xs text-slate-500">{item.note}</span>
                </div>
                <span className="text-xs text-slate-400">
                  {new Date(item.created_at).toLocaleDateString("en-IN")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Danger Zone: Delete Entire History */}
      <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50/40 p-5 shadow-xs">
        <div className="flex items-center gap-2 text-sm font-bold text-rose-900">
          <Trash2 className="h-4 w-4 text-rose-600" />
          <span>Delete Entire History</span>
        </div>
        <p className="text-xs text-rose-800/80">
          Permanently clear all monthly rent records, electric bills, security deposit entries, and rent rate history on the server and in this browser.
        </p>

        {!confirmReset ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmReset(true)}
            className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" />
            <span>Delete Entire History</span>
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-white p-3">
            <span className="text-xs font-semibold text-rose-900">
              Are you sure? This cannot be undone (unless you exported a JSON backup).
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  await onDeleteEntireHistory();
                  setConfirmReset(false);
                  setSavedNotice("Entire history deleted and reset to a fresh ledger.");
                  setTimeout(() => setSavedNotice(null), 4000);
                })();
              }}
              className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Confirm Delete Everything</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmReset(false)}
              className="inline-flex min-h-9 cursor-pointer items-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
