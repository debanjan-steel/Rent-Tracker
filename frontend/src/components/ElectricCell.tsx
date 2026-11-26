import { useEffect, useState } from "react";
import { Eraser } from "lucide-react";
import type { MonthlyEntry } from "../types";
import { paiseToInput, rupeesInputToPaise } from "../utils/format";
import { StatusPill } from "./StatusPill";

interface ElectricCellProps {
  entry: MonthlyEntry;
  busy: boolean;
  compact?: boolean;
  onSaveAmount: (entry: MonthlyEntry, amountPaise: number | null) => Promise<void>;
  onToggleStatus: (entry: MonthlyEntry, draftPaise?: number | null) => Promise<void>;
}

export function ElectricCell({
  entry,
  busy,
  compact = false,
  onSaveAmount,
  onToggleStatus,
}: ElectricCellProps) {
  const [draft, setDraft] = useState(() => paiseToInput(entry.electric_amount_paise));

  useEffect(() => {
    setDraft(paiseToInput(entry.electric_amount_paise));
  }, [entry.id, entry.electric_amount_paise]);

  const draftPaise = rupeesInputToPaise(draft);
  const hasAmount = draft.trim() !== "" && draftPaise !== null;
  const isPaid = entry.electric_status === "paid_success";

  const commitDraftIfChanged = async () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (entry.electric_amount_paise !== null) {
        await onSaveAmount(entry, null);
      }
      return;
    }
    if (draftPaise === null) {
      setDraft(paiseToInput(entry.electric_amount_paise));
      return;
    }
    if (draftPaise !== entry.electric_amount_paise) {
      await onSaveAmount(entry, draftPaise);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex items-center">
        <span className="pointer-events-none absolute left-2.5 text-xs font-semibold text-slate-400">
          ₹
        </span>
        <input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={draft}
          disabled={busy || isPaid}
          readOnly={isPaid}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => {
            const nextTarget = e.relatedTarget as HTMLElement | null;
            if (nextTarget?.dataset.electricToggle === "true") {
              return;
            }
            void commitDraftIfChanged();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          placeholder="Enter bill"
          aria-label={`Electric bill for ${entry.month_key} in INR`}
          className={`${compact ? "w-28" : "w-34"} rounded-xl border py-2 pr-2.5 pl-6 text-sm font-medium outline-none transition ${
            isPaid
              ? "border-emerald-200 bg-emerald-50/40 text-slate-700"
              : "border-slate-200 bg-white text-slate-900 focus:border-teal-600 focus:ring-2 focus:ring-teal-100"
          }`}
        />
      </div>

      {/* Show Due / Pending immediately on the right when an amount is entered; stay blank when empty */}
      {hasAmount && (
        <StatusPill
          dataElectricToggle
          status={isPaid ? "paid_success" : "due_pending"}
          disabled={busy}
          labelContext={`${entry.month_key} electric bill`}
          onClick={() => {
            void onToggleStatus(entry, draftPaise);
          }}
        />
      )}

      {!isPaid && entry.electric_amount_paise !== null && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setDraft("");
            void onSaveAmount(entry, null);
          }}
          title="Clear electric bill back to blank"
          aria-label={`Clear electric bill for ${entry.month_key}`}
          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <Eraser className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
