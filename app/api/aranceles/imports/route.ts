import { NextResponse } from 'next/server';
import { deleteImport } from '@/lib/aranceles/import-service';
import { loadHistory } from '@/lib/aranceles/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const history = await loadHistory();
    const imports = [...history.imports].sort((a, b) => b.imported_at.localeCompare(a.imported_at));
    return NextResponse.json({ imports });
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
