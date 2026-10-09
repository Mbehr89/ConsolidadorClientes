import type { CanonicalField } from "@/lib/aranceles/types";

/** Common Spanish/English header aliases for Argentine ALYC exports. */
const ALIASES: Record<Exclude<CanonicalField, "ignore">, string[]> = {
  client: [
    "cliente",
    "client",
    "nombre cliente",
    "nombre del cliente",
    "razon social",
    "razón social",
    "comitente (denominacion)",
    "comitente (denominación)",
    "denominacion",
    "denominación",
    "titular",
    "nombre",
    "name",
  ],
  client_external_id: [
    "comitente (numero)",
    "comitente (número)",
    "nro cuenta",
    "nro. cuenta",
    "numero de cuenta",
    "número de cuenta",
    "cuenta",
    "external id",
    "id cliente",
  ],
  account_officer: [
    "comitente (oficial de cuenta)",
    "oficial de cuenta",
    "oficial",
    "account officer",
  ],
  date: [
    "fecha de concertacion",
    "fecha de concertación",
    "fecha concertacion",
    "fecha concertación",
    "fecha operacion",
    "fecha operación",
    "fecha de operacion",
    "fecha de operación",
    "trade date",
    "fecha",
    "date",
    "f. operacion",
    "f.operacion",
  ],
  settlement_date: [
    "fecha de liquidacion",
    "fecha de liquidación",
    "fecha liquidacion",
    "fecha liquidación",
    "settlement date",
  ],
  instrument: [
    "instrumento (abreviatura)",
    "instrumento",
    "instrument",
    "especie",
    "ticker",
    "simbolo",
    "símbolo",
    "papel",
    "activo",
    "security",
  ],
  operation: [
    "tipo de operacion (abreviatura)",
    "tipo de operación (abreviatura)",
    "tipo operacion",
    "tipo operación",
    "operacion",
    "operación",
    "compra/venta",
    "side",
    "sentido",
    "operation",
  ],
  quantity: [
    "cantidad",
    "quantity",
    "qty",
    "nominales",
    "volumen",
    "cant",
  ],
  amount: [
    "bruto",
    "monto",
    "importe operado",
    "amount",
    "precio total",
    "valor",
  ],
  net_amount: ["neto", "net", "net amount"],
  commission: [
    "arancel (importe)",
    "importe arancel",
    "importe comision",
    "importe comisión",
    "comision",
    "comisión",
    "commission",
    "fee",
    "aranceles",
    "derechos",
    "comision bruta",
    "comisión bruta",
  ],
  commission_pct: [
    "arancel (%)",
    "arancel %",
    "comision %",
    "comisión %",
    "porcentaje arancel",
    "pct",
  ],
  currency: [
    "moneda (simbolo)",
    "moneda (símbolo)",
    "moneda",
    "currency",
    "ccy",
    "divisa",
  ],
  op_number: [
    "numero de operacion",
    "número de operación",
    "nro operacion",
    "op number",
    "numero",
    "número",
  ],
  alyc: [
    "alyc",
    "broker",
    "sociedad",
    "sociedad de bolsa",
    "agente",
    "intermediario",
  ],
};

function normalizeHeader(h: string): string {
  return h
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_./]+/g, " ")
    .replace(/\s+/g, " ");
}

function matchScore(headerNorm: string, aliasNorm: string): number {
  if (headerNorm === aliasNorm) return 3;
  if (headerNorm.startsWith(aliasNorm) || aliasNorm.startsWith(headerNorm))
    return 2;
  if (aliasNorm.length >= 4 && headerNorm.includes(aliasNorm)) return 1;
  if (headerNorm.length >= 4 && aliasNorm.includes(headerNorm)) return 1;
  return 0;
}

export function suggestField(header: string): CanonicalField {
  const n = normalizeHeader(header);
  let best: { field: CanonicalField; score: number } | null = null;

  for (const [field, aliases] of Object.entries(ALIASES) as [
    Exclude<CanonicalField, "ignore">,
    string[],
  ][]) {
    for (const alias of aliases) {
      const score = matchScore(n, normalizeHeader(alias));
      if (score > 0 && (!best || score > best.score)) {
        best = { field, score };
      }
    }
  }

  return best?.field ?? "ignore";
}

export function suggestMapping(
  headers: string[],
): Record<string, CanonicalField> {
  const used = new Set<CanonicalField>();
  const mapping: Record<string, CanonicalField> = {};

  const ranked = headers
    .map((header) => {
      const n = normalizeHeader(header);
      let best: { field: CanonicalField; score: number } | null = null;
      for (const [field, aliases] of Object.entries(ALIASES) as [
        Exclude<CanonicalField, "ignore">,
        string[],
      ][]) {
        for (const alias of aliases) {
          const score = matchScore(n, normalizeHeader(alias));
          if (score > 0 && (!best || score > best.score)) {
            best = { field, score };
          }
        }
      }
      return {
        header,
        field: best?.field ?? ("ignore" as CanonicalField),
        score: best?.score ?? 0,
      };
    })
    .sort((a, b) => b.score - a.score);

  for (const { header, field: suggested } of ranked) {
    let field = suggested;
    if (field !== "ignore" && used.has(field)) field = "ignore";
    if (field !== "ignore") used.add(field);
    mapping[header] = field;
  }

  const ordered: Record<string, CanonicalField> = {};
  for (const header of headers) ordered[header] = mapping[header] ?? "ignore";
  return ordered;
}

export const FIELD_LABELS: Record<CanonicalField, string> = {
  client: "Cliente",
  client_external_id: "N° comitente",
  account_officer: "Oficial de cuenta",
  date: "Fecha concertación",
  settlement_date: "Liquidación",
  instrument: "Instrumento",
  operation: "Operación",
  quantity: "Cantidad",
  amount: "Bruto",
  net_amount: "Neto",
  commission: "Arancel (importe)",
  commission_pct: "Arancel (%)",
  currency: "Moneda",
  op_number: "N° operación",
  alyc: "ALYC",
  ignore: "Ignorar",
};

/** Soft-required: commission can be missing on GMA rows (tracked as anomaly). */
export const REQUIRED_FIELDS: CanonicalField[] = ["client", "date"];
export const RECOMMENDED_FIELDS: CanonicalField[] = ["commission"];
