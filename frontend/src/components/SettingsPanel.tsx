import { useEffect, useState } from "react";
import { Download, History, Smartphone, Check } from "lucide-react";
import type { DashboardResponse } from "../types";
import { formatINR, paiseToInput, rupeesInputToPaise } from "../utils/format";

interface SettingsPanelProps {
  dashboard: DashboardResponse;
  busy: boolean;
  canInstallPwa: boolean;
  onInstallPwa: () => Promise<void>;
  onSaveRent: (rentPaise: number, note?: string) => Promise<void>;
  onUpdateLease: (tenantName: string, unitLabel: string, startMonth: string) => Promise<void>;
}

export function SettingsPanel({
  dashboard,
  busy,
  canInstallPwa,
  onInstallPwa,
  onSaveRent,
  onUpdateLease,
}: SettingsPanelProps) {
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
            <span>Export &amp; Backup</span>
          </div>
          <p className="text-xs text-slate-500">
            Download your complete rent, electric bill, and security deposit records.
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
    </div>
  );
}
