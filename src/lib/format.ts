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

export const dateLabel = (value: string | null | undefined) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

export const todayISO = () => new Date().toISOString().slice(0, 10);