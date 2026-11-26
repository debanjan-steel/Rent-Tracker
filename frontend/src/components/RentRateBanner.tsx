import { useEffect, useState } from "react";
import { IndianRupee, Pencil, Check, X } from "lucide-react";
import { formatINR, paiseToInput, rupeesInputToPaise } from "../utils/format";

interface RentRateBannerProps {
  currentRentPaise: number;
  dueMonthsCount: number;
  paidMonthsCount: number;
  busy: boolean;
  onSaveRent: (newRentPaise: number) => Promise<void>;
}

export function RentRateBanner({
  currentRentPaise,
  dueMonthsCount,
  paidMonthsCount,
  busy,
  onSaveRent,
}: RentRateBannerProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => paiseToInput(currentRentPaise));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setDraft(paiseToInput(currentRentPaise));
    }
  }, [currentRentPaise, editing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const paise = rupeesInputToPaise(draft);
    if (paise === null) {
      setError("Enter a valid non-negative rent amount.");
      return;
    }
    setError(null);
    await onSaveRent(paise);
    setEditing(false);
  };

  return (
    <section className="rounded-2xl border border-teal-200 bg-gradient-to-r from-teal-50 via-white to-emerald-50 p-4 shadow-xs">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-teal-800 uppercase">
            <IndianRupee className="h-3.5 w-3.5" />
            <span>Monthly Rent Rate</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">{formatINR(currentRentPaise)}</span>
            <span className="text-xs text-slate-500">per month (auto-fills unpaid months)</span>
          </div>
          <p className="text-xs text-slate-600">
            Changing this updates{" "}
            <span className="font-semibold text-amber-700">{dueMonthsCount} Due / Pending</span>{" "}
            {dueMonthsCount === 1 ? "month" : "months"} —{" "}
            <span className="font-semibold text-emerald-700">{paidMonthsCount} Paid / Success</span>{" "}
            {paidMonthsCount === 1 ? "month stays" : "months stay"} locked.
          </p>
        </div>

        {!editing ? (
          <button
            type="button"
            onClick={() => {
              setDraft(currentRentPaise === 0 ? "" : paiseToInput(currentRentPaise));
              setEditing(true);
            }}
            className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 self-start rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white shadow-xs transition hover:bg-teal-800 sm:self-center"
          >
            <Pencil className="h-4 w-4" />
            <span>{currentRentPaise === 0 ? "Set Monthly Rent" : "Change Rent"}</span>
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:items-end">
            <div className="flex items-center gap-2">
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm font-semibold text-slate-500">
                  ₹
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="e.g. 12000"
                  aria-label="Monthly rent amount in INR"
                  className="w-36 rounded-xl border border-teal-300 bg-white py-2 pr-3 pl-7 text-sm font-semibold text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-200"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex min-h-10 cursor-pointer items-center gap-1 rounded-xl bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
              >
                <Check className="h-4 w-4" />
                <span>Apply</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                aria-label="Cancel rent edit"
                className="inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-slate-600 hover:bg-slate-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
          </form>
        )}
      </div>
    </section>
  );
}
