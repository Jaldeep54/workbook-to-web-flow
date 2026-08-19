export const inr = (value: number | null | undefined, decimals = 0) =>
  `₹${(Number(value) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;

export const num = (value: number | null | undefined, decimals = 0) =>
  (Number(value) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

/** Indian-style abbreviated currency for tight spaces (chart labels) — e.g. ₹1.2L, ₹3.4Cr. */
export const inrCompact = (value: number | null | undefined) => {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(1)}Cr`;
  if (abs >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `₹${(n / 1_000).toFixed(1)}k`;
  return inr(n);
};

export const dateLabel = (value: string | null | undefined) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

export const todayISO = () => new Date().toISOString().slice(0, 10);
