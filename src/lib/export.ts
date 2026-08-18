/** Client-side CSV export used by every dashboard and table. */
export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  if (rows.length === 0) return "";
  const keys = columns ?? Object.keys(rows[0]);
  const escape = (value: unknown) => {
    if (value === null || value === undefined) return "";
    const s = String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(","), ...rows.map((row) => keys.map((k) => escape(row[k])).join(","))].join(
    "\n",
  );
}

export function downloadCsv(
  filename: string,
  rows: Array<Record<string, unknown>>,
  columns?: string[],
) {
  const csv = toCsv(rows, columns);
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  downloadBlob(filename.endsWith(".csv") ? filename : `${filename}.csv`, blob);
}

/** Triggers a browser download for any already-fetched Blob (CSV, PDF, ...). */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Pulls the filename out of a `Content-Disposition: attachment; filename="..."` header. */
export function filenameFromContentDisposition(header: string | null, fallback: string): string {
  const match = header?.match(/filename="?([^";]+)"?/);
  return match?.[1] ?? fallback;
}
