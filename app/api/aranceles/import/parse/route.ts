import { NextResponse } from 'next/server';
import { normalizeParsed, parseImportBuffer } from '@/lib/aranceles/pipeline';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');
    const fallbackDate = form.get('fallbackDate');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Subí un archivo Excel (.xlsx o .xls).' }, { status: 400 });
    }
    if (!/\.(xlsx|xls|xlsm)$/i.test(file.name)) {
      return NextResponse.json({ error: 'Formato no soportado. Usá .xlsx o .xls.' }, { status: 400 });
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const imp = parseImportBuffer(buffer, file.name, {
      fallbackDate: typeof fallbackDate === 'string' && fallbackDate ? fallbackDate : null,
    });

    if (imp.empty) {
      return NextResponse.json({
        filename: file.name,
        sheetName: imp.parsed.sheetName,
        headers: [],
        totalRows: 0,
        previewRows: [],
        suggestedMapping: {},
        detectedFormat: imp.format,
        formatLabel: imp.formatLabel,
        segment: imp.segment,
        empty: true,
        sampleNormalized: [],
        sampleErrors: [],
        sampleMissingFees: 0,
        suggestedAlycName: imp.suggestedAlycName,
      });
    }

    const sample = normalizeParsed(imp);
    return NextResponse.json({
      filename: file.name,
      sheetName: imp.parsed.sheetName,
      headers: imp.parsed.headers,
      totalRows: imp.parsed.totalRows,
      previewRows: imp.parsed.previewRows.slice(0, 10),
      suggestedMapping: imp.mapping,
      detectedFormat: imp.format,
      formatLabel: imp.formatLabel,
      segment: imp.segment,
      empty: false,
      sampleNormalized: sample.rows.slice(0, 10),
      sampleErrors: sample.errors.slice(0, 10),
      sampleMissingFees: sample.rows.filter((r) => r.feeStatus === 'missing').length,
      suggestedAlycName: imp.suggestedAlycName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo leer el archivo.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
