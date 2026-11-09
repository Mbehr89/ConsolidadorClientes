import { NextResponse } from 'next/server';
import { loadSegmentedHistory } from '@/lib/aranceles/segment-store';
import { coerceSettings } from '@/lib/aranceles/settings';
import { mutateHistory } from '@/lib/aranceles/store';
import { coerceBalances, type BalancesConfig } from '@/lib/balances/config';
import { collectIncome } from '@/lib/balances/income';
import { GRUPOS_ASESOR } from '@/lib/grupo-asesor';
import { getGruposAsesor } from '@/lib/config-store/accessors';

function fail(err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : fallback;
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET() {
  try {
    const { history, commissions } = await loadSegmentedHistory();
    const settings = coerceSettings(history.settings);
    const income = collectIncome(commissions, settings);
    const catalog = await getGruposAsesor().catch(() => [...GRUPOS_ASESOR]);
    const known = new Set<string>(catalog);
    for (const cell of income) if (cell.grupo) known.add(cell.grupo);
    for (const p of settings.balances.partners) if (p.grupo) known.add(p.grupo);
    for (const e of settings.balances.expenses) if (e.grupo) known.add(e.grupo);
    return NextResponse.json({
      config: settings.balances,
      income,
      grupos: [...known],
    });
  } catch (err) {
    return fail(err, 'No se pudo armar el balance.');
  }
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }
  const config = coerceBalances((body as { config?: unknown })?.config);
  try {
    const history = await mutateHistory((h) => {
      const settings = coerceSettings(h.settings);
      settings.balances = config;
      const next = { ...h, settings };
      return { history: next, result: next };
    });
    return NextResponse.json({ config: coerceSettings(history.settings).balances satisfies BalancesConfig });
  } catch (err) {
    return fail(err, 'No se pudo guardar el balance.');
  }
}
