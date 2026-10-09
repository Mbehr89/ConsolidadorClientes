import { NextResponse } from 'next/server';
import {
  filterCommissions,
  listAlycs,
  listClients,
  sortByDateDesc,
  summarize,
} from '@/lib/aranceles/history';
import { getArancelesStorageInfo, loadHistory } from '@/lib/aranceles/store';
import type { CommissionFilters, FeeStatus } from '@/lib/aranceles/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sp = url.searchParams;
    const filters: CommissionFilters = {
      alyc: sp.get('alyc') || null,
      client: sp.get('client') || null,
      from: sp.get('from') || null,
      to: sp.get('to') || null,
      q: sp.get('q') || null,
      feeStatus: (sp.get('status') as FeeStatus | 'anomaly' | null) || null,
    };
    const limit = Math.min(Math.max(Number(sp.get('limit')) || 200, 1), 1000);

    const history = await loadHistory();
    const filtered = filterCommissions(history.commissions, filters);
    const lastImport = [...history.imports].sort((a, b) => b.imported_at.localeCompare(a.imported_at))[0] ?? null;

    return NextResponse.json({
      storage: getArancelesStorageInfo(),
      updatedAt: history.updated_at,
      lastImport,
      importCount: history.imports.length,
      alycs: listAlycs(history),
      clients: listClients(history),
      summary: summarize(filtered),
      total: filtered.length,
      rows: sortByDateDesc(filtered).slice(0, limit),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al leer el historial de aranceles.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
