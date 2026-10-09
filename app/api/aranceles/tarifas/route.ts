import { NextResponse } from 'next/server';
import { runFeeAnalysis } from '@/lib/aranceles/history';
import { loadHistory, mutateHistory } from '@/lib/aranceles/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const history = await loadHistory();
    return NextResponse.json({ schedules: history.fee_schedules });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al cargar tarifas.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Recalcula tarifas sugeridas y estados de arancel sobre todo el historial. */
export async function POST() {
  try {
    const schedules = await mutateHistory((history) => {
      const analyzed = runFeeAnalysis(history);
      return { history: analyzed, result: analyzed.fee_schedules };
    });
    return NextResponse.json({ schedules });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo recalcular.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
