import { NextResponse } from 'next/server';
import { parseBondPaymentCalendarCsv } from '@/lib/bonds/parse-calendar';

export const dynamic = 'force-dynamic';

/**
 * Descarga el CSV de calendario (Google Sheets export) y devuelve eventos parseados.
 * Configurar `BOND_PAYMENTS_URL` en Vercel (URL pública de export CSV).
 */
export async function GET() {
  const url = process.env.BOND_PAYMENTS_URL?.trim();
  if (!url) {
    return NextResponse.json({
      events: [] as unknown[],
      configured: false,
      message: 'Definí BOND_PAYMENTS_URL con el export CSV del calendario de pagos.',
    });
  }

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json(
        { error: `No se pudo descargar el calendario (${res.status}).`, configured: true },
        { status: 502 }
      );
    }
    const text = await res.text();
    const events = parseBondPaymentCalendarCsv(text);
    const serialized = events.map((e) => ({
      asset: e.asset,
      issuer: e.issuer,
      date: e.date.toISOString(),
      currency: e.currency,
      flowPer100: e.flowPer100,
      couponPer100: e.couponPer100,
      amortizationPer100: e.amortizationPer100,
      residualPctOfPar: e.residualPctOfPar,
    }));
    return NextResponse.json({ events: serialized, configured: true });
  } catch (err) {
    console.error('[bonds/calendar]', err);
    return NextResponse.json({ error: 'Error al procesar calendario de bonos.' }, { status: 500 });
  }
}
