import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { Style } from '@react-pdf/types';
import type { ClientExportData, OperationExportRow } from '@/lib/aranceles/export-model';
import { formatDate, formatMoney, formatMonth, formatNumber, formatPct, formatTotals } from '@/lib/aranceles/format';
import { DEFAULT_BRAND_PRIMARY, DEFAULT_BRAND_ROW_ALT } from '@/lib/export/pdf-types';

const PAD = 28;

const styles = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 8, paddingTop: 64, paddingBottom: 40, paddingHorizontal: PAD, color: '#111' },
  brand: {
    position: 'absolute',
    top: 16,
    left: PAD,
    right: PAD,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandLogo: { maxHeight: 30, maxWidth: 300, objectFit: 'contain' },
  brandText: { fontSize: 8, color: '#556274' },
  title: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: DEFAULT_BRAND_PRIMARY },
  subtitle: { fontSize: 10, color: '#333', marginTop: 2 },
  muted: { fontSize: 8, color: '#666', marginTop: 2 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, marginBottom: 12 },
  box: { borderWidth: 0.5, borderColor: '#c9d3df', borderRadius: 3, padding: 6, minWidth: 120 },
  boxLabel: { fontSize: 7, color: '#666', textTransform: 'uppercase' },
  boxValue: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 2 },
  sectionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: DEFAULT_BRAND_PRIMARY, marginBottom: 4 },
  header: { flexDirection: 'row', backgroundColor: DEFAULT_BRAND_PRIMARY, paddingVertical: 4 },
  headerText: { color: '#fff', fontFamily: 'Helvetica-Bold', fontSize: 7, paddingHorizontal: 3 },
  row: { flexDirection: 'row', paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: '#dde3ea' },
  cell: { fontSize: 7, paddingHorizontal: 3 },
  sub: { fontSize: 6.5, color: '#666' },
  warn: { fontSize: 6.5, color: '#b45309' },
  info: { fontSize: 6.5, color: '#0369a1' },
  footer: { position: 'absolute', bottom: 16, left: PAD, right: PAD, fontSize: 7, color: '#999', textAlign: 'center' },
});

type Col = { label: string; width: number; align?: 'right' };

const COLUMNS: Col[] = [
  { label: 'Concert.', width: 50 },
  { label: 'Liquid.', width: 50 },
  { label: 'Boleto', width: 44 },
  { label: 'ALYC', width: 40 },
  { label: 'Operación', width: 84 },
  { label: 'Instrumento', width: 62 },
  { label: 'Cantidad', width: 56, align: 'right' },
  { label: 'Bruto', width: 82, align: 'right' },
  { label: 'Arancel %', width: 50, align: 'right' },
  { label: 'Arancel', width: 86, align: 'right' },
  { label: 'Esperado', width: 58, align: 'right' },
  { label: 'Estado', width: 88 },
];

function cellStyle(col: Col): Style[] {
  return [styles.cell, { width: col.width, textAlign: col.align ?? 'left' }];
}

function OperationRow({ r, alt }: { r: OperationExportRow; alt: boolean }) {
  const c = COLUMNS;
  return (
    <View style={[styles.row, alt ? { backgroundColor: DEFAULT_BRAND_ROW_ALT } : {}]} wrap={false}>
      <Text style={cellStyle(c[0]!)}>{formatDate(r.tradeDate)}</Text>
      <Text style={cellStyle(c[1]!)}>{formatDate(r.settlementDate)}</Text>
      <Text style={cellStyle(c[2]!)}>{r.opNumber ?? '-'}</Text>
      <View style={cellStyle(c[3]!)}>
        <Text>{r.alyc}</Text>
        {r.account && <Text style={styles.sub}>Cta. {r.account}</Text>}
        <Text style={styles.sub}>{r.feeType}</Text>
      </View>
      <View style={cellStyle(c[4]!)}>
        <Text>{r.operation ?? '-'}</Text>
        {r.category && <Text style={styles.sub}>{r.category}</Text>}
      </View>
      <Text style={cellStyle(c[5]!)}>{r.instrument ?? '-'}</Text>
      <Text style={cellStyle(c[6]!)}>{r.quantity != null ? formatNumber(r.quantity) : '-'}</Text>
      <Text style={cellStyle(c[7]!)}>{r.amount != null ? formatMoney(r.amount, r.currency) : '-'}</Text>
      <Text style={cellStyle(c[8]!)}>{r.commissionPct != null ? formatPct(r.commissionPct) : '-'}</Text>
      <View style={cellStyle(c[9]!)}>
        <Text>{formatMoney(r.commission, r.commissionCurrency)}</Text>
        {r.commissionInOpCurrency != null && (
          <Text style={styles.warn}>
            ~ {formatMoney(r.commissionInOpCurrency, r.currency)}
            {r.fx != null ? ` · TC ${formatNumber(r.fx)}` : ''}
          </Text>
        )}
      </View>
      <Text style={cellStyle(c[10]!)}>{r.expected != null ? formatMoney(r.expected, r.currency) : '-'}</Text>
      <View style={cellStyle(c[11]!)}>
        <Text>{r.status}</Text>
        {r.trading && <Text style={styles.info}>Posible trading ({r.trading})</Text>}
      </View>
    </View>
  );
}

export function ClientArancelesPdf({ data, logo }: { data: ClientExportData; logo: string | null }) {
  return (
    <Document title={`Aranceles - ${data.client}`}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.brand} fixed>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          {logo ? <Image src={logo} style={styles.brandLogo} /> : <Text style={styles.brandText}>BEHR ADVISORY</Text>}
          <Text style={styles.brandText}>Aranceles ALYC · {data.client}</Text>
        </View>

        <Text style={styles.title}>Detalle de aranceles</Text>
        <Text style={styles.subtitle}>{data.client}</Text>
        {data.segmentLabel ? <Text style={styles.muted}>{data.segmentLabel}</Text> : null}
        {data.rangeLabel ? <Text style={styles.muted}>{data.rangeLabel}</Text> : null}
        <Text style={styles.muted}>Generado {data.generatedAt.toLocaleString('es-AR')}</Text>

        <View style={styles.summary}>
          <View style={styles.box}>
            <Text style={styles.boxLabel}>Aranceles</Text>
            <Text style={styles.boxValue}>{formatTotals(data.totals)}</Text>
          </View>
          <View style={styles.box}>
            <Text style={styles.boxLabel}>Operaciones</Text>
            <Text style={styles.boxValue}>{formatNumber(data.rowCount)}</Text>
          </View>
          {data.byMonth.length > 1 &&
            data.byMonth.map((m) => (
              <View key={m.month} style={styles.box}>
                <Text style={styles.boxLabel}>
                  {formatMonth(m.month)} · {m.rows} op.
                </Text>
                <Text style={styles.boxValue}>{formatTotals(m.totals)}</Text>
              </View>
            ))}
        </View>

        <Text style={styles.sectionTitle}>Operaciones</Text>
        <View style={styles.header} fixed>
          {COLUMNS.map((col) => (
            <Text key={col.label} style={[styles.headerText, { width: col.width, textAlign: col.align ?? 'left' }]}>
              {col.label}
            </Text>
          ))}
        </View>
        {data.rows.map((r, i) => (
          <OperationRow key={`${r.opNumber ?? ''}-${i}`} r={r} alt={i % 2 === 1} />
        ))}

        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
        />
      </Page>
    </Document>
  );
}
