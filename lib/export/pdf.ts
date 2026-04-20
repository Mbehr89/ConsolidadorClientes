import React from 'react';
import { BROKERS } from '@/lib/brokers';
import type { BrokerCode, Position } from '@/lib/schema';
import { aggregateByField, monedaDimensionKey, totalAumUsd } from '@/lib/analysis/exposure';
import {
  type PdfOptions,
  type PdfOptionsResolved,
  type PdfReportData,
  DEFAULT_BRAND_PRIMARY,
  DEFAULT_BRAND_ROW_ALT,
  brokerOrder,
} from './pdf-types';

export type { PdfOptions } from './pdf-types';

function localDateYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function longDateEs(d: Date): string {
  return d.toLocaleDateString('es-AR', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function subtitleFor(positions: Position[], clienteId?: string): string {
  if (positions.length === 0) return 'Book Completo';
  const ids = new Set(positions.map((p) => p.cliente_id));
  if (clienteId && ids.size === 1 && ids.has(clienteId)) return positions[0]!.titular;
  if (ids.size === 1) return positions[0]!.titular;
  return 'Book Completo';
}

function defaultDisclaimer(quoteDate: string): string {
  return `Este reporte es informativo y no constituye recomendación de inversión. Los valores son aproximados basados en cotizaciones del día ${quoteDate}. La información se elabora a partir de datos provistos por las instituciones y puede diferir de los saldos definitivos.`;
}

function buildPdfData(positions: Position[], clienteId?: string): PdfReportData {
  const total = totalAumUsd(positions);
  const byBrokerRaw = aggregateByField(positions, (p) => p.broker);
  const byClaseRaw = aggregateByField(positions, (p) => p.clase_activo);
  const byMonedaRaw = aggregateByField(positions, monedaDimensionKey);
  const byLocRaw = aggregateByField(positions, (p) => BROKERS[p.broker].tipo);

  const standard: BrokerCode[] = ['MS', 'NETX360', 'GMA', 'IEB'];
  const byBroker: PdfReportData['byBroker'] = [];
  const seen = new Set<string>();
  for (const code of standard) {
    const aum = byBrokerRaw[code] ?? 0;
    if (aum <= 0) continue;
    seen.add(code);
    byBroker.push({
      code,
      name: BROKERS[code].nombre,
      aum,
      pct: total > 0 ? (aum / total) * 100 : 0,
    });
  }
  for (const code of Object.keys(byBrokerRaw).sort((a, b) => brokerOrder(a) - brokerOrder(b))) {
    if (seen.has(code)) continue;
    const aum = byBrokerRaw[code]!;
    if (aum <= 0) continue;
    byBroker.push({
      code,
      name: BROKERS[code as BrokerCode]?.nombre ?? code,
      aum,
      pct: total > 0 ? (aum / total) * 100 : 0,
    });
  }

  const byClase = Object.entries(byClaseRaw)
    .sort((a, b) => b[1] - a[1])
    .map(([key, aum]) => ({
      key,
      aum,
      pct: total > 0 ? (aum / total) * 100 : 0,
    }));

  const nonCash = positions
    .filter((p) => p.clase_activo !== 'cash')
    .sort((a, b) => (b.valor_mercado_usd ?? 0) - (a.valor_mercado_usd ?? 0))
    .slice(0, 20);

  const topPositions = nonCash.map((p) => {
    const usd = p.valor_mercado_usd ?? 0;
    return {
      ticker: p.ticker ?? '',
      desc: p.descripcion,
      clase: p.clase_activo,
      broker: p.broker,
      qty: p.cantidad,
      usd,
      pct: total > 0 ? (usd / total) * 100 : 0,
    };
  });

  const localOffshore = Object.entries(byLocRaw)
    .sort((a, b) => b[1] - a[1])
    .map(([tipo, aum]) => ({
      tipo: tipo === 'local' ? 'Local' : tipo === 'offshore' ? 'Offshore' : tipo,
      aum,
      pct: total > 0 ? (aum / total) * 100 : 0,
    }));

  const byMoneda = Object.entries(byMonedaRaw)
    .sort((a, b) => b[1] - a[1])
    .map(([key, aum]) => ({
      key,
      aum,
      pct: total > 0 ? (aum / total) * 100 : 0,
    }));

  const byPaisRaw = aggregateByField(
    positions.filter((p) => p.pais_emisor != null && p.pais_emisor !== ''),
    (p) => p.pais_emisor!
  );
  const topPais = Object.entries(byPaisRaw)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pais, aum]) => ({
      pais,
      aum,
      pct: total > 0 ? (aum / total) * 100 : 0,
    }));

  const fechas = [...new Set(positions.map((p) => p.fecha_reporte))].sort();
  const quoteIso = fechas.length ? fechas[fechas.length - 1]! : localDateYmd();
  const quoteDate = quoteIso;
  const reportDateLabel = longDateEs(new Date());

  return {
    subtitle: subtitleFor(positions, clienteId),
    reportDateLabel,
    quoteDate,
    totalAum: total,
    byBroker,
    byClase,
    topPositions,
    localOffshore,
    byMoneda,
    topPais,
  };
}

function resolvePdfOptions(positions: Position[], options?: PdfOptions): PdfOptionsResolved {
  const fechas = [...new Set(positions.map((p) => p.fecha_reporte))].sort();
  const quoteIso = fechas.length ? fechas[fechas.length - 1]! : localDateYmd();
  const quoteLabel = quoteIso;

  const disclaimer =
    options?.disclaimerText ??
    defaultDisclaimer(quoteLabel);

  return {
    logoBase64: options?.logoBase64 ?? null,
    brandColors: {
      primary: options?.brandColors?.primary ?? DEFAULT_BRAND_PRIMARY,
      rowAlt: options?.brandColors?.rowAlt ?? DEFAULT_BRAND_ROW_ALT,
    },
    disclaimerText: disclaimer,
    advisorSignature: options?.advisorSignature ?? '',
  };
}

export async function exportToPdf(
  positions: Position[],
  clienteId?: string,
  options?: PdfOptions
): Promise<void> {
  if (typeof window === 'undefined') return;

  const data = buildPdfData(positions, clienteId);
  const resolved = resolvePdfOptions(positions, options);

  const [{ pdf }, { TenenciasPdfDocument }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./pdf-document'),
  ]);

  const el = React.createElement(TenenciasPdfDocument, { data, options: resolved });
  // react-pdf tipa el root como <Document />; nuestro componente lo renderiza internamente.
  const blob = await pdf(el as Parameters<typeof pdf>[0]).toBlob();

  const fname = options?.filename?.endsWith('.pdf')
    ? options.filename
    : options?.filename
      ? `${options.filename}.pdf`
      : `reporte_tenencias_${localDateYmd()}.pdf`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
