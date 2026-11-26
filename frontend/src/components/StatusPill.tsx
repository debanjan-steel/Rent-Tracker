import { CheckCircle2, Clock3 } from "lucide-react";

interface StatusPillProps {
  status: "due_pending" | "paid_success";
  onClick: () => void;
  disabled?: boolean;
  labelContext: string;
  dataElectricToggle?: boolean;
}

export function StatusPill({
  status,
  onClick,
  disabled = false,
  labelContext,
  dataElectricToggle = false,
}: StatusPillProps) {
  const isPaid = status === "paid_success";

  return (
    <button
      type="button"
      data-electric-toggle={dataElectricToggle ? "true" : undefined}
      onClick={onClick}
      disabled={disabled}
      title={isPaid ? `Click to revert ${labelContext} to Due / Pending` : `Click to mark ${labelContext} Paid / Success`}
      aria-label={`${labelContext}: ${isPaid ? "Paid / Success" : "Due / Pending"}. Click to toggle.`}
      className={`inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${
        isPaid
          ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
          : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
      }`}
    >
      {isPaid ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Clock3 className="h-3.5 w-3.5 text-amber-600" />}
      <span>{isPaid ? "Paid / Success" : "Due / Pending"}</span>
    </button>
  );
}
