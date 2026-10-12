import { NextResponse } from 'next/server';
import { integrityReport } from '@/lib/aranceles/dedup';
import { importUsage } from '@/lib/aranceles/history';
import { deleteImport } from '@/lib/aranceles/import-service';
import { loadHistory } from '@/lib/aranceles/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const history = await loadHistory();
    const imports = [...history.imports].sort((a, b) => b.imported_at.localeCompare(a.imported_at));
    const report = integrityReport(history.commissions);
    return NextResponse.json({
      imports,
      usage: importUsage(history),
      integrity: {
        operations: report.operations,
        withId: report.withId,
        withoutId: report.withoutId,
        duplicateGroups: report.duplicateGroups.length,
        duplicateSample: report.duplicateGroups.slice(0, 10).map((g) => g.op_number),
        sharedIdGroups: report.sharedIdGroups.length,
        sharedIdSample: report.sharedIdGroups.slice(0, 10).map((g) => ({
          op_number: g.op_number,
          rows: g.ids.length,
          imports: [...new Set(g.ids.map((id) => history.commissions.find((c) => c.id === id)?.import_id))],
        })),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al listar importaciones.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id')?.trim();
  if (!id) return NextResponse.json({ error: 'Falta el id de la importación.' }, { status: 400 });
  try {
    const result = await deleteImport(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo borrar la importación.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
