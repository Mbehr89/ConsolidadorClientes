import { NextResponse } from 'next/server';
import {
  filterCommissions,
  listAlycs,
  listClients,
  listMonths,
  sortByDateDesc,
  summarize,
} from '@/lib/aranceles/history';
import { netAmountOf } from '@/lib/aranceles/net';
import { loadSegmentedHistory } from '@/lib/aranceles/segment-store';
import { coerceSettings } from '@/lib/aranceles/settings';
import {
  filterBySegment,
  parseSegmentFilters,
  segmentBreakdowns,
  segmentOptions,
} from '@/lib/aranceles/segments';
import { getArancelesStorageInfo } from '@/lib/aranceles/store';
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

    const measure = sp.get('measure') === 'net' ? 'net' : 'gross';

    const { history, commissions } = await loadSegmentedHistory();
    let filtered = filterBySegment(filterCommissions(commissions, filters), parseSegmentFilters(sp));
    let withoutNet: { rows: number; totals: Record<string, number> } | null = null;
    if (measure === 'net') {
      const settings = coerceSettings(history.settings);
      const skipped = { rows: 0, totals: {} as Record<string, number> };
      const net: typeof filtered = [];
      for (const c of filtered) {
        const amount = netAmountOf(c, settings);
        if (amount == null) {
          skipped.rows += 1;
          const cur = c.commission_currency || c.currency;
          skipped.totals[cur] = (skipped.totals[cur] ?? 0) + c.commission;
        } else {
          net.push({ ...c, commission: amount, commission_pct: null });
        }
      }
      filtered = net;
      withoutNet = skipped;
    }
    const lastImport = [...history.imports].sort((a, b) => b.imported_at.localeCompare(a.imported_at))[0] ?? null;

    return NextResponse.json({
      storage: getArancelesStorageInfo(),
      updatedAt: history.updated_at,
      lastImport,
      importCount: history.imports.length,
      alycs: listAlycs(history),
      clients: listClients(history),
      months: listMonths(commissions),
      segmentOptions: segmentOptions(commissions),
      measure,
      withoutNet,
      summary: summarize(filtered),
      segments: segmentBreakdowns(filtered),
      total: filtered.length,
      rows: sortByDateDesc(filtered).slice(0, limit),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al leer el historial de aranceles.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
