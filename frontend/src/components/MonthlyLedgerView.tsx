import { useEffect, useState } from "react";
import { CalendarPlus, Plus, Trash2, Zap, Home, StickyNote } from "lucide-react";
import type { MonthlyEntry } from "../types";
import { formatINR, formatMonthLabel, nextMonthKey } from "../utils/format";
import { ElectricCell } from "./ElectricCell";
import { StatusPill } from "./StatusPill";

interface MonthlyLedgerViewProps {
  mode: "columns" | "tabs";
  months: MonthlyEntry[];
  busy: boolean;
  onAddMonth: (monthKey?: string) => Promise<MonthlyEntry | undefined>;
  onDeleteMonth: (monthId: number) => Promise<void>;
  onToggleRent: (entry: MonthlyEntry) => Promise<void>;
  onSaveElectricAmount: (entry: MonthlyEntry, amountPaise: number | null) => Promise<void>;
  onToggleElectric: (entry: MonthlyEntry, draftPaise?: number | null) => Promise<void>;
  onSaveNotes: (monthId: number, notes: string) => Promise<void>;
}

export function MonthlyLedgerView({
  mode,
  months,
  busy,
  onAddMonth,
  onDeleteMonth,
  onToggleRent,
  onSaveElectricAmount,
  onToggleElectric,
  onSaveNotes,
}: MonthlyLedgerViewProps) {
  const [selectedMonthId, setSelectedMonthId] = useState<number | null>(
    months.length > 0 ? months[0].id : null,
  );
  const [customMonth, setCustomMonth] = useState("");
  const [showCustomPicker, setShowCustomPicker] = useState(false);

  useEffect(() => {
    if (months.length === 0) {
      setSelectedMonthId(null);
      return;
    }
    if (!months.some((m) => m.id === selectedMonthId)) {
      setSelectedMonthId(months[0].id);
    }
  }, [months, selectedMonthId]);

  const activeMonth = months.find((m) => m.id === selectedMonthId) ?? months[0] ?? null;

  const [notesDraft, setNotesDraft] = useState(activeMonth?.notes ?? "");
  useEffect(() => {
    setNotesDraft(activeMonth?.notes ?? "");
  }, [activeMonth?.id, activeMonth?.notes]);

  const suggestedNext =
    months.length > 0 ? nextMonthKey(months[months.length - 1].month_key) : "";

  const handleQuickAddNext = async () => {
    const created = await onAddMonth();
    if (created) {
      setSelectedMonthId(created.id);
    }
  };

  const handleAddCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customMonth) return;
    const created = await onAddMonth(customMonth);
    if (created) {
      setSelectedMonthId(created.id);
    }
    setCustomMonth("");
    setShowCustomPicker(false);
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            {mode === "columns" ? "Monthly Rent & Electric Columns" : "Month-by-Month Tabs"}
          </h2>
          <p className="text-xs text-slate-500">
            Rent pre-fills automatically. Electric bill starts blank — enter amount to show Due / Pending, then tap to mark Paid / Success.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void handleQuickAddNext();
            }}
            className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-xl bg-teal-700 px-3.5 py-2 text-sm font-semibold text-white shadow-xs transition hover:bg-teal-800 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" />
            <span>Add {suggestedNext ? formatMonthLabel(suggestedNext) : "Month"}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowCustomPicker((prev) => !prev)}
            className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <CalendarPlus className="h-4 w-4 text-teal-700" />
            <span>Pick Month</span>
          </button>
        </div>
      </div>

      {showCustomPicker && (
        <form
          onSubmit={handleAddCustom}
          className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-xs"
        >
          <label className="text-xs font-semibold text-slate-600" htmlFor="custom-month-input">
            Select Month:
          </label>
          <input
            id="custom-month-input"
            type="month"
            required
            value={customMonth}
            onChange={(e) => setCustomMonth(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-teal-600"
          />
          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-9 cursor-pointer items-center rounded-xl bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800"
          >
            Add
          </button>
        </form>
      )}

      {months.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No months added yet. Click <strong>Add Month</strong> to start tracking.
        </div>
      ) : mode === "columns" ? (
        <>
          {/* Desktop / Tablet Column Table */}
          <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs md:block">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold tracking-wide text-slate-600 uppercase">
                    <th className="px-4 py-3">Month</th>
                    <th className="px-4 py-3">Rent</th>
                    <th className="px-4 py-3">Electric Bill</th>
                    <th className="px-4 py-3">Month Total</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {months.map((entry) => {
                    const monthTotalPaise = entry.rent_amount_paise + (entry.electric_amount_paise ?? 0);
                    return (
                      <tr key={entry.id} className="transition hover:bg-slate-50/70">
                        <td className="px-4 py-3.5 align-middle">
                          <div className="font-semibold text-slate-900">{formatMonthLabel(entry.month_key)}</div>
                          <div className="text-xs text-slate-400">{entry.month_key}</div>
                        </td>

                        <td className="px-4 py-3.5 align-middle">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span className="min-w-20 font-semibold text-slate-900">
                              {formatINR(entry.rent_amount_paise)}
                            </span>
                            <StatusPill
                              status={entry.rent_status}
                              disabled={busy}
                              labelContext={`${entry.month_key} rent`}
                              onClick={() => {
                                void onToggleRent(entry);
                              }}
                            />
                          </div>
                          {entry.rent_paid_date && (
                            <div className="mt-1 text-[11px] text-emerald-700">Paid on {entry.rent_paid_date}</div>
                          )}
                        </td>

                        <td className="px-4 py-3.5 align-middle">
                          <ElectricCell
                            entry={entry}
                            busy={busy}
                            compact
                            onSaveAmount={onSaveElectricAmount}
                            onToggleStatus={onToggleElectric}
                          />
                          {entry.electric_paid_date && (
                            <div className="mt-1 text-[11px] text-emerald-700">Paid on {entry.electric_paid_date}</div>
                          )}
                        </td>

                        <td className="px-4 py-3.5 align-middle font-bold text-slate-900">
                          {formatINR(monthTotalPaise)}
                        </td>

                        <td className="px-4 py-3.5 text-right align-middle">
                          <button
                            type="button"
                            disabled={busy || months.length <= 1}
                            onClick={() => {
                              void onDeleteMonth(entry.id);
                            }}
                            title={months.length <= 1 ? "Keep at least one month" : "Delete month"}
                            aria-label={`Delete ${entry.month_key}`}
                            className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Cards for Columns Mode */}
          <div className="space-y-3 md:hidden">
            {months.map((entry) => {
              const monthTotalPaise = entry.rent_amount_paise + (entry.electric_amount_paise ?? 0);
              return (
                <div
                  key={entry.id}
                  className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                    <div>
                      <div className="text-base font-bold text-slate-900">{formatMonthLabel(entry.month_key)}</div>
                      <div className="text-xs text-slate-400">Total: {formatINR(monthTotalPaise)}</div>
                    </div>
                    <button
                      type="button"
                      disabled={busy || months.length <= 1}
                      onClick={() => {
                        void onDeleteMonth(entry.id);
                      }}
                      aria-label={`Delete ${entry.month_key}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-slate-500 uppercase">Rent</div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-base font-bold text-slate-900">
                        {formatINR(entry.rent_amount_paise)}
                      </span>
                      <StatusPill
                        status={entry.rent_status}
                        disabled={busy}
                        labelContext={`${entry.month_key} rent`}
                        onClick={() => {
                          void onToggleRent(entry);
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-slate-500 uppercase">Electric Bill</div>
                    <ElectricCell
                      entry={entry}
                      busy={busy}
                      onSaveAmount={onSaveElectricAmount}
                      onToggleStatus={onToggleElectric}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        /* Per-Month Tabs Mode */
        <div className="space-y-4">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {months.map((m) => {
              const selected = activeMonth?.id === m.id;
              const fullyPaid = m.rent_status === "paid_success" && m.electric_status !== "due_pending";
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedMonthId(m.id)}
                  className={`inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                    selected
                      ? "border-teal-700 bg-teal-700 text-white shadow-xs"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span>{formatMonthLabel(m.month_key)}</span>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      fullyPaid ? "bg-emerald-400" : "bg-amber-400"
                    }`}
                  />
                </button>
              );
            })}
          </div>

          {activeMonth && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-xl font-bold text-slate-900">
                    {formatMonthLabel(activeMonth.month_key)}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Combined Month Total:{" "}
                    <span className="font-bold text-slate-800">
                      {formatINR(activeMonth.rent_amount_paise + (activeMonth.electric_amount_paise ?? 0))}
                    </span>
                  </p>
                </div>

                <button
                  type="button"
                  disabled={busy || months.length <= 1}
                  onClick={() => {
                    void onDeleteMonth(activeMonth.id);
                  }}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete Month</span>
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {/* Rent Card inside Month Tab */}
                <div className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-600 uppercase">
                    <Home className="h-4 w-4 text-teal-700" />
                    <span>Monthly Rent</span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-2xl font-bold text-slate-900">
                        {formatINR(activeMonth.rent_amount_paise)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {activeMonth.rent_paid_date
                          ? `Paid on ${activeMonth.rent_paid_date}`
                          : "Auto-filled from Rent Rate"}
                      </div>
                    </div>
                    <StatusPill
                      status={activeMonth.rent_status}
                      disabled={busy}
                      labelContext={`${activeMonth.month_key} rent`}
                      onClick={() => {
                        void onToggleRent(activeMonth);
                      }}
                    />
                  </div>
                </div>

                {/* Electric Bill Card inside Month Tab */}
                <div className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-600 uppercase">
                    <Zap className="h-4 w-4 text-amber-600" />
                    <span>Electric Bill</span>
                  </div>

                  <div>
                    <ElectricCell
                      entry={activeMonth}
                      busy={busy}
                      onSaveAmount={onSaveElectricAmount}
                      onToggleStatus={onToggleElectric}
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      {activeMonth.electric_paid_date
                        ? `Paid on ${activeMonth.electric_paid_date}`
                        : activeMonth.electric_amount_paise === null
                          ? "Leave blank until bill arrives. Enter amount to show Due / Pending."
                          : "Click Due / Pending when payment is received."}
                    </p>
                  </div>
                </div>
              </div>

              {/* Optional Month Notes */}
              <div className="mt-4 space-y-1.5">
                <label
                  htmlFor="month-notes"
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"
                >
                  <StickyNote className="h-3.5 w-3.5" />
                  <span>Month Notes (optional — e.g. meter reading or UPI reference)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    id="month-notes"
                    type="text"
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    onBlur={() => {
                      if (notesDraft.trim() !== activeMonth.notes) {
                        void onSaveNotes(activeMonth.id, notesDraft);
                      }
                    }}
                    placeholder="Add meter reading, payment mode, or note..."
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-teal-600"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
