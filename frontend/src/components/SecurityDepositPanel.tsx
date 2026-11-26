import { useEffect, useState } from "react";
import { CheckCircle2, RotateCcw, ShieldCheck, ShieldAlert } from "lucide-react";
import type { LeasePeriod } from "../types";
import { formatINR, paiseToInput, rupeesInputToPaise, todayIso } from "../utils/format";

interface SecurityDepositPanelProps {
  lease: LeasePeriod;
  busy: boolean;
  onSaveDeposit: (amountPaise: number, givenDate: string | null, notes: string) => Promise<void>;
  onReturnDeposit: (
    returnedPaise: number,
    returnedDate: string | null,
    endMonth: string | null,
    markLeaseEnded: boolean,
    notes: string,
  ) => Promise<void>;
  onReopenDeposit: () => Promise<void>;
}

export function SecurityDepositPanel({
  lease,
  busy,
  onSaveDeposit,
  onReturnDeposit,
  onReopenDeposit,
}: SecurityDepositPanelProps) {
  const [amountDraft, setAmountDraft] = useState(() => paiseToInput(lease.security_deposit_paise || null));
  const [givenDate, setGivenDate] = useState(lease.deposit_given_date ?? todayIso());
  const [notes, setNotes] = useState(lease.deposit_notes);

  const [showReturnForm, setShowReturnForm] = useState(false);
  const [returnedDraft, setReturnedDraft] = useState(() => paiseToInput(lease.security_deposit_paise));
  const [returnedDate, setReturnedDate] = useState(lease.deposit_returned_date ?? todayIso());
  const [endMonth, setEndMonth] = useState(lease.end_month ?? "");
  const [markEnded, setMarkEnded] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAmountDraft(lease.security_deposit_paise > 0 ? paiseToInput(lease.security_deposit_paise) : "");
    setGivenDate(lease.deposit_given_date ?? todayIso());
    setNotes(lease.deposit_notes);
    setReturnedDraft(paiseToInput(lease.security_deposit_paise));
    setReturnedDate(lease.deposit_returned_date ?? todayIso());
    setEndMonth(lease.end_month ?? "");
  }, [lease]);

  const isReturned =
    lease.deposit_status === "returned" || lease.deposit_status === "partially_returned";

  const handleSaveInitial = async (e: React.FormEvent) => {
    e.preventDefault();
    const paise = amountDraft.trim() === "" ? 0 : rupeesInputToPaise(amountDraft);
    if (paise === null) {
      setError("Enter a valid deposit amount.");
      return;
    }
    setError(null);
    await onSaveDeposit(paise, givenDate || null, notes);
  };

  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const returnedPaise = rupeesInputToPaise(returnedDraft);
    if (returnedPaise === null || returnedPaise > lease.security_deposit_paise) {
      setError("Returned amount must be between ₹0 and the original deposit held.");
      return;
    }
    setError(null);
    await onReturnDeposit(
      returnedPaise,
      returnedDate || todayIso(),
      endMonth || null,
      markEnded,
      notes,
    );
    setShowReturnForm(false);
  };

  return (
    <div className="space-y-4">
      {/* Status Banner */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              {isReturned ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : lease.deposit_status === "held" ? (
                <ShieldCheck className="h-4 w-4 text-teal-700" />
              ) : (
                <ShieldAlert className="h-4 w-4 text-amber-600" />
              )}
              <span>Security Deposit ({lease.unit_label})</span>
            </div>

            <div className="text-3xl font-bold text-slate-900">
              {formatINR(lease.security_deposit_paise)}
            </div>

            <p className="text-xs text-slate-500">
              {lease.deposit_status === "not_set" && "No security deposit recorded yet for the start of this renting period."}
              {lease.deposit_status === "held" &&
                `Held since ${lease.deposit_given_date ?? lease.start_month} — must be returned when renting period ends.`}
              {lease.deposit_status === "returned" &&
                `Full deposit returned on ${lease.deposit_returned_date ?? "end of lease"}.`}
              {lease.deposit_status === "partially_returned" &&
                `Returned ${formatINR(lease.deposit_returned_paise ?? 0)} of ${formatINR(lease.security_deposit_paise)} on ${lease.deposit_returned_date ?? "end of lease"}.`}
            </p>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
              lease.deposit_status === "returned"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : lease.deposit_status === "partially_returned"
                  ? "border-teal-200 bg-teal-50 text-teal-800"
                  : lease.deposit_status === "held"
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-slate-200 bg-slate-100 text-slate-600"
            }`}
          >
            {lease.deposit_status === "returned" && "Returned"}
            {lease.deposit_status === "partially_returned" && "Partially Returned"}
            {lease.deposit_status === "held" && "Held (Returnable at End)"}
            {lease.deposit_status === "not_set" && "Not Recorded"}
          </span>
        </div>
      </div>

      {/* Record / Edit Initial Deposit */}
      {!isReturned && (
        <form
          onSubmit={handleSaveInitial}
          className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
        >
          <h3 className="text-base font-bold text-slate-900">
            Deposit Given at Start of Renting Period
          </h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600" htmlFor="deposit-amount">
                Security Deposit Amount (₹)
              </label>
              <input
                id="deposit-amount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={amountDraft}
                onChange={(e) => setAmountDraft(e.target.value)}
                placeholder="e.g. 50000"
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:border-teal-600"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600" htmlFor="deposit-date">
                Date Given
              </label>
              <input
                id="deposit-date"
                type="date"
                value={givenDate}
                onChange={(e) => setGivenDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-600"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-600" htmlFor="deposit-notes">
              Notes (payment mode, conditions, etc.)
            </label>
            <input
              id="deposit-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Paid via UPI at move-in; refundable on move-out"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-600"
            />
          </div>

          {error && <p className="text-xs font-medium text-rose-600">{error}</p>}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-10 cursor-pointer items-center rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
            >
              Save Deposit Details
            </button>

            {lease.security_deposit_paise > 0 && !showReturnForm && (
              <button
                type="button"
                onClick={() => setShowReturnForm(true)}
                className="inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
              >
                End Period &amp; Return Deposit
              </button>
            )}
          </div>
        </form>
      )}

      {/* End-of-Period Return Flow */}
      {showReturnForm && !isReturned && (
        <form
          onSubmit={handleReturnSubmit}
          className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50/40 p-5 shadow-xs"
        >
          <h3 className="text-base font-bold text-slate-900">Return Security Deposit</h3>
          <p className="text-xs text-slate-600">
            Record the amount returned back when the renting period finishes.
          </p>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600" htmlFor="return-amount">
                Amount Returned (₹)
              </label>
              <input
                id="return-amount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={returnedDraft}
                onChange={(e) => setReturnedDraft(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-teal-600"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600" htmlFor="return-date">
                Return Date
              </label>
              <input
                id="return-date"
                type="date"
                value={returnedDate}
                onChange={(e) => setReturnedDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-600"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600" htmlFor="end-month">
                End Month (optional)
              </label>
              <input
                id="end-month"
                type="month"
                value={endMonth}
                onChange={(e) => setEndMonth(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-600"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={markEnded}
              onChange={(e) => setMarkEnded(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-700"
            />
            <span>Mark this renting period as ended</span>
          </label>

          {(() => {
            const parsedReturn = rupeesInputToPaise(returnedDraft);
            if (parsedReturn !== null && parsedReturn < lease.security_deposit_paise) {
              const retained = lease.security_deposit_paise - parsedReturn;
              return (
                <div className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs text-slate-700">
                  Original Deposit: <strong>{formatINR(lease.security_deposit_paise)}</strong> &bull; Returning:{" "}
                  <strong>{formatINR(parsedReturn)}</strong> &bull; Deduction / Retained:{" "}
                  <strong className="text-amber-800">{formatINR(retained)}</strong>
                </div>
              );
            }
            return null;
          })()}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-10 cursor-pointer items-center rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              Confirm Deposit Returned
            </button>
            <button
              type="button"
              onClick={() => setShowReturnForm(false)}
              className="inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Undo Return Option */}
      {isReturned && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
          <div className="text-sm text-emerald-900">
            <strong>Settled:</strong> {formatINR(lease.deposit_returned_paise ?? 0)} returned
            {lease.deposit_returned_date ? ` on ${lease.deposit_returned_date}` : ""}.
            {lease.deposit_notes ? ` (${lease.deposit_notes})` : ""}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void onReopenDeposit();
            }}
            className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reopen as Held</span>
          </button>
        </div>
      )}
    </div>
  );
}
