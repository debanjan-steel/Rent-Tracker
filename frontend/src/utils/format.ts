const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatINR(paise: number): string {
  const rupees = paise / 100;
  const hasDecimals = paise % 100 !== 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: hasDecimals ? 2 : 0,
  }).format(rupees);
}

export function paiseToInput(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) {
    return "";
  }
  const rupees = paise / 100;
  return paise % 100 === 0 ? String(Math.trunc(rupees)) : rupees.toFixed(2);
}

export function rupeesInputToPaise(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.round(parsed * 100);
}

export function formatMonthLabel(monthKey: string): string {
  const [year, monthStr] = monthKey.split("-");
  const idx = Number(monthStr) - 1;
  const name = MONTH_NAMES[idx] ?? monthStr;
  return `${name} ${year}`;
}

export function nextMonthKey(monthKey: string): string {
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (month === 12) {
    return `${String(year + 1).padStart(4, "0")}-01`;
  }
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}`;
}

export function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function makeMutationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `mut-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
