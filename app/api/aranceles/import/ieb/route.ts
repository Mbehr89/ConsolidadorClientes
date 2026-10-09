import { NextResponse } from 'next/server';
import { commitIebPeriod } from '@/lib/aranceles/import-service';
import { IEB_SEGMENTS, type IebSegment } from '@/lib/aranceles/mappers/ieb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** Período IEB multi-archivo. Cualquier subconjunto de segmentos es válido. */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const periodLabelRaw = String(form.get('periodLabel') ?? '').trim();
    const fallbackDate = String(form.get('fallbackDate') ?? '').trim();
    const alycName = String(form.get('alycName') ?? 'IEB').trim() || 'IEB';

    if (!/^\d{4}-\d{2}-\d{2}$/.test(fallbackDate)) {
      return NextResponse.json(
        { error: 'Indicá una fecha de período (AAAA-MM-DD) para segmentos sin fecha (p. ej. ACDI).' },
        { status: 400 }
      );
    }

    const files: { segment: IebSegment; filename: string; buffer: Uint8Array }[] = [];
    for (const seg of IEB_SEGMENTS) {
      const file = form.get(seg.id);
      if (!file || !(file instanceof File) || file.size === 0) continue;
      files.push({ segment: seg.id, filename: file.name, buffer: new Uint8Array(await file.arrayBuffer()) });
    }
    if (files.length === 0) {
      return NextResponse.json(
        { error: 'Subí al menos un segmento IEB. Los demás pueden quedar vacíos.' },
        { status: 400 }
      );
    }

    const periodLabel = periodLabelRaw || fallbackDate.slice(0, 7);
    const result = await commitIebPeriod({ files, fallbackDate, periodLabel, alycName });
    return NextResponse.json({ ok: true, periodLabel, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al importar IEB.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
