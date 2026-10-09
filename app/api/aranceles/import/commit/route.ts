import { NextResponse } from 'next/server';
import { commitManualImport, missingRequiredFields, prepareFile } from '@/lib/aranceles/import-service';
import type { ColumnMapping } from '@/lib/aranceles/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    const mappingRaw = form.get('mapping');
    const alycName = String(form.get('alycName') ?? '').trim();
    const notes = form.get('notes');
    const fallbackDateRaw = form.get('fallbackDate');
    const fallbackDate = typeof fallbackDateRaw === 'string' && fallbackDateRaw ? fallbackDateRaw : null;

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Subí un archivo Excel (.xlsx o .xls).' }, { status: 400 });
    }
    if (!mappingRaw || typeof mappingRaw !== 'string') {
      return NextResponse.json({ error: 'Falta el mapeo de columnas.' }, { status: 400 });
    }
    if (!alycName) {
      return NextResponse.json({ error: 'Indicá la ALYC.' }, { status: 400 });
    }

    const mapping = JSON.parse(mappingRaw) as ColumnMapping;
    const missing = missingRequiredFields(mapping, Boolean(fallbackDate));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Mapeá las columnas obligatorias: ${missing.join(', ')}.` },
        { status: 400 }
      );
    }

    const prepared = prepareFile(new Uint8Array(await file.arrayBuffer()), file.name, {
      fallbackDate,
      mapping,
    });

    if (prepared.imp.empty) {
      return NextResponse.json({
        ok: true,
        importId: null,
        rowCount: 0,
        empty: true,
        message: 'Archivo vacío: no se importaron filas.',
      });
    }
    if (!prepared.rows.length) {
      return NextResponse.json(
        {
          error: 'Ninguna fila válida para importar. Revisá el mapeo de columnas.',
          errors: prepared.errors.slice(0, 20),
        },
        { status: 400 }
      );
    }

    const result = await commitManualImport({
      prepared,
      alycName,
      notes: notes ? String(notes) : null,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      skipped: prepared.skipped,
      errorCount: prepared.errors.length,
      errors: prepared.errors.slice(0, 20),
      missingFeeCount: prepared.rows.filter((r) => r.feeStatus === 'missing').length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al importar.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
