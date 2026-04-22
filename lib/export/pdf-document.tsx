import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { PdfOptionsResolved, PdfReportData } from './pdf-types';

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    paddingTop: 56.7,
    paddingBottom: 56.7,
    paddingHorizontal: 56.7,
    color: '#111',
  },
  coverTitle: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: '#1e3a5f',
    marginBottom: 12,
    textAlign: 'center',
  },
  coverSubtitle: {
    fontSize: 14,
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  coverDate: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
  },
  logoBox: {
    height: 72,
    marginBottom: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#ccc',
    padding: 8,
  },
  logoPlaceholder: {
    fontSize: 9,
    color: '#999',
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    color: '#1e3a5f',
    marginBottom: 12,
    marginTop: 8,
  },
  aumBig: {
    fontSize: 28,
    fontFamily: 'Helvetica-Bold',
    color: '#1e3a5f',
    marginBottom: 16,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#1e3a5f',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  tableHeaderText: {
    color: '#fff',
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: '#ddd',
  },
  rowAlt: {
    backgroundColor: '#f5f5f5',
  },
  cell: {
    fontSize: 8,
    color: '#222',
  },
  disclaimer: {
    fontSize: 9,
    color: '#444',
    lineHeight: 1.5,
    textAlign: 'justify',
  },
  signature: {
    marginTop: 24,
    fontSize: 9,
    color: '#333',
    fontFamily: 'Helvetica-Oblique',
  },
  pageFooter: {
    position: 'absolute',
    bottom: 28,
    left: 56.7,
    right: 56.7,
    fontSize: 8,
    color: '#999',
    textAlign: 'center',
  },
  watermark: {
    position: 'absolute',
    top: '36%',
    left: '10%',
    width: '80%',
    opacity: 0.06,
  },
  pageBrandHeader: {
    position: 'absolute',
    top: 18,
    left: 56.7,
    right: 56.7,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pageBrandLogo: {
    maxHeight: 34,
    maxWidth: 360,
    objectFit: 'contain',
  },
  pageBrandText: {
    fontSize: 8,
    color: '#556274',
  },
});

function fmtUsd(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtPct(p: number): string {
  return `${p.toFixed(1)}%`;
}

function fmtQty(n: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 4 }).format(n);
}

interface Props {
  data: PdfReportData;
  options: PdfOptionsResolved;
}

export function TenenciasPdfDocument({ data, options }: Props) {
  const primary = options.brandColors.primary;
  const rowAlt = options.brandColors.rowAlt;
  const headerStyle = [styles.tableHeader, { backgroundColor: primary }];
  const watermarkSource = options.watermarkBase64 ?? options.logoBase64;
  const Watermark = watermarkSource ? (
    // eslint-disable-next-line jsx-a11y/alt-text
    <Image src={watermarkSource} style={styles.watermark} fixed />
  ) : null;
  const BrandHeader = options.logoBase64 ? (
    <View style={styles.pageBrandHeader} fixed>
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <Image src={options.logoBase64} style={styles.pageBrandLogo} />
      <Text style={styles.pageBrandText}>BEHR ADVISORY</Text>
    </View>
  ) : null;

  return (
    <Document>
      {/* Portada */}
      <Page size="A4" style={styles.page}>
        {Watermark}
        {options.logoBase64 ? (
          <View style={{ alignItems: 'center', marginBottom: 24 }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image src={options.logoBase64} style={{ maxHeight: 64, maxWidth: 180, objectFit: 'contain' }} />
          </View>
        ) : (
          <View style={styles.logoBox}>
            <Text style={styles.logoPlaceholder}>Espacio para logo (configurable)</Text>
          </View>
        )}
        <Text style={[styles.coverTitle, { color: primary }]}>Reporte de Tenencias Consolidado</Text>
        <Text style={styles.coverSubtitle}>{data.subtitle}</Text>
        <Text style={styles.coverDate}>Fecha del reporte: {data.reportDateLabel}</Text>
        <Text
          style={styles.pageFooter}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          fixed
        />
      </Page>

      {/* Resumen */}
      <Page size="A4" style={styles.page}>
        {Watermark}
        {BrandHeader}
        <Text style={[styles.sectionTitle, { color: primary }]}>Resumen</Text>
        <Text style={[styles.aumBig, { color: primary }]}>{fmtUsd(data.totalAum)}</Text>
        <Text style={{ marginBottom: 8, fontSize: 9, color: '#555' }}>AUM total estimado en USD</Text>

        <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', marginBottom: 4, color: primary }}>
          Por broker
        </Text>
        <View style={headerStyle}>
          <Text style={[styles.tableHeaderText, { width: '18%' }]}>Broker</Text>
          <Text style={[styles.tableHeaderText, { width: '42%' }]}>Nombre</Text>
          <Text style={[styles.tableHeaderText, { width: '22%', textAlign: 'right' }]}>AUM USD</Text>
          <Text style={[styles.tableHeaderText, { width: '18%', textAlign: 'right' }]}>%</Text>
        </View>
        {data.byBroker.map((r, i) => (
          <View key={r.code} style={[styles.row, i % 2 === 1 ? { backgroundColor: rowAlt } : {}]}>
            <Text style={[styles.cell, { width: '18%' }]}>{r.code}</Text>
            <Text style={[styles.cell, { width: '42%' }]}>{r.name}</Text>
            <Text style={[styles.cell, { width: '22%', textAlign: 'right' }]}>{fmtUsd(r.aum)}</Text>
            <Text style={[styles.cell, { width: '18%', textAlign: 'right' }]}>{fmtPct(r.pct)}</Text>
          </View>
        ))}

        <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 16, marginBottom: 4, color: primary }}>
          Por clase de activo
        </Text>
        <View style={headerStyle}>
          <Text style={[styles.tableHeaderText, { width: '50%' }]}>Clase</Text>
          <Text style={[styles.tableHeaderText, { width: '28%', textAlign: 'right' }]}>AUM USD</Text>
          <Text style={[styles.tableHeaderText, { width: '22%', textAlign: 'right' }]}>%</Text>
        </View>
        {data.byClase.map((r, i) => (
          <View key={r.key} style={[styles.row, i % 2 === 1 ? { backgroundColor: rowAlt } : {}]}>
            <Text style={[styles.cell, { width: '50%' }]}>{r.key}</Text>
            <Text style={[styles.cell, { width: '28%', textAlign: 'right' }]}>{fmtUsd(r.aum)}</Text>
            <Text style={[styles.cell, { width: '22%', textAlign: 'right' }]}>{fmtPct(r.pct)}</Text>
          </View>
        ))}
        <Text
          style={styles.pageFooter}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          fixed
        />
      </Page>

      {/* Top posiciones */}
      <Page size="A4" style={styles.page}>
        {Watermark}
        {BrandHeader}
        <Text style={[styles.sectionTitle, { color: primary }]}>
          Detalle — Top 20 posiciones (sin efectivo)
        </Text>
        <View style={headerStyle}>
          <Text style={[styles.tableHeaderText, { width: '11%' }]}>Ticker</Text>
          <Text style={[styles.tableHeaderText, { width: '26%' }]}>Descripción</Text>
          <Text style={[styles.tableHeaderText, { width: '10%' }]}>Clase</Text>
          <Text style={[styles.tableHeaderText, { width: '10%' }]}>Broker</Text>
          <Text style={[styles.tableHeaderText, { width: '12%', textAlign: 'right' }]}>Cant.</Text>
          <Text style={[styles.tableHeaderText, { width: '15%', textAlign: 'right' }]}>Valor USD</Text>
          <Text style={[styles.tableHeaderText, { width: '16%', textAlign: 'right' }]}>% Portf.</Text>
        </View>
        {data.topPositions.map((r, i) => (
          <View key={i} style={[styles.row, i % 2 === 1 ? { backgroundColor: rowAlt } : {}]}>
            <Text style={[styles.cell, { width: '11%' }]}>{r.ticker || '—'}</Text>
            <Text style={[styles.cell, { width: '26%' }]}>{r.desc.slice(0, 48)}{r.desc.length > 48 ? '…' : ''}</Text>
            <Text style={[styles.cell, { width: '10%' }]}>{r.clase}</Text>
            <Text style={[styles.cell, { width: '10%' }]}>{r.broker}</Text>
            <Text style={[styles.cell, { width: '12%', textAlign: 'right' }]}>{fmtQty(r.qty)}</Text>
            <Text style={[styles.cell, { width: '15%', textAlign: 'right' }]}>{fmtUsd(r.usd)}</Text>
            <Text style={[styles.cell, { width: '16%', textAlign: 'right' }]}>{fmtPct(r.pct)}</Text>
          </View>
        ))}
        <Text
          style={styles.pageFooter}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          fixed
        />
      </Page>

      {/* Breakdown visual */}
      <Page size="A4" style={styles.page}>
        {Watermark}
        {BrandHeader}
        <Text style={[styles.sectionTitle, { color: primary }]}>Distribución</Text>

        <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', marginBottom: 4, color: primary }}>
          Local vs offshore
        </Text>
        <View style={headerStyle}>
          <Text style={[styles.tableHeaderText, { width: '40%' }]}>Tipo</Text>
          <Text style={[styles.tableHeaderText, { width: '35%', textAlign: 'right' }]}>AUM USD</Text>
          <Text style={[styles.tableHeaderText, { width: '25%', textAlign: 'right' }]}>%</Text>
        </View>
        {data.localOffshore.map((r, i) => (
          <View key={r.tipo} style={[styles.row, i % 2 === 1 ? { backgroundColor: rowAlt } : {}]}>
            <Text style={[styles.cell, { width: '40%' }]}>{r.tipo}</Text>
            <Text style={[styles.cell, { width: '35%', textAlign: 'right' }]}>{fmtUsd(r.aum)}</Text>
            <Text style={[styles.cell, { width: '25%', textAlign: 'right' }]}>{fmtPct(r.pct)}</Text>
          </View>
        ))}

        <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 4, color: primary }}>
          Por moneda
        </Text>
        <View style={headerStyle}>
          <Text style={[styles.tableHeaderText, { width: '45%' }]}>Moneda</Text>
          <Text style={[styles.tableHeaderText, { width: '30%', textAlign: 'right' }]}>AUM USD</Text>
          <Text style={[styles.tableHeaderText, { width: '25%', textAlign: 'right' }]}>%</Text>
        </View>
        {data.byMoneda.map((r, i) => (
          <View key={r.key} style={[styles.row, i % 2 === 1 ? { backgroundColor: rowAlt } : {}]}>
            <Text style={[styles.cell, { width: '45%' }]}>{r.key}</Text>
            <Text style={[styles.cell, { width: '30%', textAlign: 'right' }]}>{fmtUsd(r.aum)}</Text>
            <Text style={[styles.cell, { width: '25%', textAlign: 'right' }]}>{fmtPct(r.pct)}</Text>
          </View>
        ))}

        <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 4, color: primary }}>
          País emisor (top 5)
        </Text>
        <View style={headerStyle}>
          <Text style={[styles.tableHeaderText, { width: '35%' }]}>País</Text>
          <Text style={[styles.tableHeaderText, { width: '40%', textAlign: 'right' }]}>AUM USD</Text>
          <Text style={[styles.tableHeaderText, { width: '25%', textAlign: 'right' }]}>%</Text>
        </View>
        {data.topPais.map((r, i) => (
          <View key={r.pais} style={[styles.row, i % 2 === 1 ? { backgroundColor: rowAlt } : {}]}>
            <Text style={[styles.cell, { width: '35%' }]}>{r.pais}</Text>
            <Text style={[styles.cell, { width: '40%', textAlign: 'right' }]}>{fmtUsd(r.aum)}</Text>
            <Text style={[styles.cell, { width: '25%', textAlign: 'right' }]}>{fmtPct(r.pct)}</Text>
          </View>
        ))}
        <Text
          style={styles.pageFooter}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          fixed
        />
      </Page>

      {/* Disclaimer */}
      <Page size="A4" style={styles.page}>
        {Watermark}
        {BrandHeader}
        <Text style={[styles.sectionTitle, { color: primary }]}>Aviso legal</Text>
        <Text style={styles.disclaimer}>{options.disclaimerText}</Text>
        {options.advisorSignature ? <Text style={styles.signature}>{options.advisorSignature}</Text> : null}
        <Text
          style={styles.pageFooter}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}
