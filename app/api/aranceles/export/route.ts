import { NextResponse } from 'next/server';
import { describeHistoryContents, exportFilename, summarizeBackup } from '@/lib/aranceles/backup';
import { loadHistory } from '@/lib/aranceles/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const history = await loadHistory();
    const summary = summarizeBackup(history);
    return NextResponse.json({
      ...summary,
      filename: exportFilename(summary.lastOperationDate, summary.operations),
      contents: describeHistoryContents(history),
      history,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo exportar el historial.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
