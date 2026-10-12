import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isSenebiToCharge } from '@/lib/aranceles/control';
import { mutateHistory } from '@/lib/aranceles/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  id: z.string().min(1),
  /** `null` borra el importe cargado. */
  amount: z.number().finite().positive().max(1e12).nullable(),
});

class ManualFeeError extends Error {}

/** Carga (o borra) el arancel a cobrar de una operación SENEBI que la ALYC liquidó sin arancel. */
export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Importe inválido: tiene que ser un número mayor a cero.' }, { status: 400 });
  }
  const { id, amount } = parsed.data;
  try {
    const saved = await mutateHistory((h) => {
      const target = h.commissions.find((c) => c.id === id);
      if (!target) throw new ManualFeeError('No se encontró la operación (¿se borró la importación?).');
      if (!isSenebiToCharge(target)) {
        throw new ManualFeeError('Sólo se puede cargar el importe a cobrar en operaciones SENEBI sin arancel.');
      }
      const commissions = h.commissions.map((c) => (c.id === id ? { ...c, manual_commission: amount } : c));
      return { history: { ...h, commissions }, result: { id, amount } };
    });
    return NextResponse.json(saved);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo guardar el importe.';
    return NextResponse.json({ error: message }, { status: err instanceof ManualFeeError ? 400 : 500 });
  }
}
