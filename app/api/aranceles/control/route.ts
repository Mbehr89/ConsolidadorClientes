import { NextResponse } from 'next/server';
import { anomalySummary, filterCommissions, listAlycs, listAnomalies } from '@/lib/aranceles/history';
import { loadHistory } from '@/lib/aranceles/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const limit = Math.min(Math.max(Number(sp.get('limit')) || 500, 1), 2000);
    const history = await loadHistory();
    const scoped = filterCommissions(history.commissions, {
      alyc: sp.get('alyc') || null,
      from: sp.get('from') || null,
      to: sp.get('to') || null,
    });
    const anomalies = listAnomalies(scoped);
    return NextResponse.json({
      alycs: listAlycs(history),
      summary: anomalySummary(scoped),
      total: anomalies.length,
      rows: anomalies.slice(0, limit),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al cargar control.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
