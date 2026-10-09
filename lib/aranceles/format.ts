const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2,
});

const num = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 2,
});

const dateFmt = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const usd = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export function formatMoney(value: number, currency = "ARS"): string {
  if (currency.startsWith("USD")) {
    const base = usd.format(value);
    return currency === "USD" ? base : `${base} (${currency.replace("USD_", "")})`;
  }
  if (currency !== "ARS") return `${num.format(value)} ${currency}`;
  return ars.format(value);
}

/** "ARS $ 1.234 · USD 56" para totales separados por moneda. */
export function formatTotals(totals: Record<string, number>): string {
  const entries = Object.entries(totals).sort(([a], [b]) =>
    a === "ARS" ? -1 : b === "ARS" ? 1 : a.localeCompare(b),
  );
  if (entries.length === 0) return formatMoney(0);
  return entries.map(([cur, v]) => formatMoney(v, cur)).join(" · ");
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return num.format(value);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return dateFmt.format(d);
}

export function formatMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  const d = new Date(y, m - 1, 1);
  return new Intl.DateTimeFormat("es-AR", {
    month: "short",
    year: "numeric",
  }).format(d);
}
