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

const amountFmt = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Importe sin símbolo, siempre con 2 decimales (la moneda va en otra columna). */
export function formatAmount(value: number): string {
  return amountFmt.format(value);
}

/** "USD_C" → "USD (C)". */
export function currencyLabel(currency: string): string {
  return currency.startsWith("USD_") ? `USD (${currency.slice(4)})` : currency;
}

/** ARS primero, después el resto alfabético. */
export function currencyEntries(totals: Record<string, number>): [string, number][] {
  return Object.entries(totals).sort(([a], [b]) =>
    a === "ARS" ? -1 : b === "ARS" ? 1 : a.localeCompare(b),
  );
}

/** "ARS $ 1.234 · USD 56" para totales separados por moneda. */
export function formatTotals(totals: Record<string, number>): string {
  const entries = currencyEntries(totals);
  if (entries.length === 0) return formatMoney(0);
  return entries.map(([cur, v]) => formatMoney(v, cur)).join(" · ");
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return num.format(value);
}

const pctFmt = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 5,
});

/** Los % de arancel de cauciones son muy chicos (ej. 0,00411 %): se muestran hasta 5 decimales. */
export function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${pctFmt.format(value)} %`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return dateFmt.format(d);
}

/** Claves de `periodKey`: '2026-03' → "mar 2026", '2026-T1' → "1T 2026", '2026' → "2026". */
export function formatPeriod(key: string): string {
  const quarter = /^(\d{4})-T([1-4])$/.exec(key);
  if (quarter) return `${quarter[2]}T ${quarter[1]}`;
  if (/^\d{4}-\d{2}$/.test(key)) return formatMonth(key);
  return key;
}

/** '2026-09' → "septiembre 2026". */
export function formatMonthLong(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" })
    .format(new Date(y, m - 1, 1))
    .replace(" de ", " ");
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
