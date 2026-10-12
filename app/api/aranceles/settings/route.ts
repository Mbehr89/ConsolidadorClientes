import { NextResponse } from 'next/server';
import { z } from 'zod';
import { accountsWithoutProducer, detectAccountChanges, summarizeProducers } from '@/lib/aranceles/producers';
import { NET_BUCKETS, coerceSettings, currentRule, type ArancelesSettings } from '@/lib/aranceles/settings';
import { loadHistory, mutateHistory } from '@/lib/aranceles/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');
const rate = z.number().min(0).max(1);
const divisor = z.number().min(1).max(2);
const text = z.string().trim().max(500).nullable();

const bucketRule = z.object({ share: rate, iva_pesos: divisor, iva_dolares: divisor });

const settingsSchema = z.object({
  net_rules: z
    .array(
      z.object({
        id: z.string().min(1),
        valid_from: isoDate,
        iibb_rate: rate,
        buckets: z.object(Object.fromEntries(NET_BUCKETS.map((b) => [b, bucketRule])) as Record<string, typeof bucketRule>),
        gma_share: rate,
        notes: text,
        created_at: z.string(),
      })
    )
    .min(1, 'Tiene que haber al menos una versión de alícuotas.'),
  producers: z.array(
    z.object({ numero: z.string().trim().min(1), codigo: text, nombre: text, notas: text })
  ),
  agreements: z.array(
    z
      .object({
        id: z.string().min(1),
        productor_numero: z.string().trim().min(1),
        valid_from: isoDate,
        valid_to: isoDate.nullable(),
        shares: z.object(Object.fromEntries(NET_BUCKETS.map((b) => [b, rate.optional()])) as Record<string, z.ZodOptional<typeof rate>>),
        notas: text,
        created_at: z.string(),
      })
      .refine((a) => !a.valid_to || a.valid_to >= a.valid_from, 'La fecha "hasta" es anterior a "desde".')
  ),
  person_aliases: z.array(
    z.object({
      alias: z.string().trim().min(1).max(60),
      nombres: z.array(z.string().trim().min(1).max(120)).max(30),
    })
  ),
  account_transfers: z.array(
    z.object({
      id: z.string().min(1),
      cuenta: z.string().trim().min(1),
      productor_numero: z.string().trim().min(1),
      valid_from: isoDate,
      notas: text,
      created_at: z.string(),
    })
  ),
});

function payload(history: Awaited<ReturnType<typeof loadHistory>>) {
  const settings = coerceSettings(history.settings);
  return {
    settings,
    currentRules: currentRule(settings),
    producers: summarizeProducers(history.commissions, settings),
    accountChanges: detectAccountChanges(history.commissions, settings),
    accountsWithoutProducer: accountsWithoutProducer(history.commissions, settings),
  };
}

export async function GET() {
  try {
    return NextResponse.json(payload(await loadHistory()));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al cargar la configuración.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }
  const parsed = settingsSchema.safeParse((body as { settings?: unknown })?.settings);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `Configuración inválida: ${issue?.path.join('.')} ${issue?.message ?? ''}`.trim() },
      { status: 400 }
    );
  }
  const froms = parsed.data.net_rules.map((r) => r.valid_from);
  if (new Set(froms).size !== froms.length) {
    return NextResponse.json({ error: 'Hay dos versiones de alícuotas con la misma fecha de vigencia.' }, { status: 400 });
  }
  try {
    const history = await mutateHistory((h) => {
      const next = { ...h, settings: coerceSettings(parsed.data as ArancelesSettings) };
      return { history: next, result: next };
    });
    return NextResponse.json(payload(history));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo guardar la configuración.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
