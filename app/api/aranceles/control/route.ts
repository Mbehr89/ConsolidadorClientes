import { NextResponse } from 'next/server';
import {
  CONTROL_SORT_KEYS,
  controlSummary,
  isControlStatus,
  listControlRows,
  listSenebiToCharge,
  splitTradingReviews,
  type ControlSort,
  type ControlSortKey,
} from '@/lib/aranceles/control';
import { filterCommissions, listAlycs, listMonths } from '@/lib/aranceles/history';
import { filterBySegment, parseSegmentFilters, segmentOptions } from '@/lib/aranceles/segments';
import { loadSegmentedHistory } from '@/lib/aranceles/segment-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const limit = Math.min(Math.max(Number(sp.get('limit')) || 500, 1), 2000);
    const rawSort = sp.get('sort') as ControlSortKey | null;
    const sort: ControlSort = {
      by: rawSort && CONTROL_SORT_KEYS.includes(rawSort) ? rawSort : 'estado',
      dir: sp.get('dir') === 'desc' ? 'desc' : 'asc',
    };
    const rawStatus = sp.get('status');
    const { history, commissions } = await loadSegmentedHistory();
    const scoped = filterBySegment(
      filterCommissions(commissions, {
        alyc: sp.get('alyc') || null,
        from: sp.get('from') || null,
        to: sp.get('to') || null,
      }),
      parseSegmentFilters(sp)
    );
    const { groups: trading, rest } = splitTradingReviews(scoped, commissions);
    const rows = listControlRows(rest, sort, isControlStatus(rawStatus) ? rawStatus : null);
    return NextResponse.json({
      alycs: listAlycs(history),
      months: listMonths(history.commissions),
      segmentOptions: segmentOptions(commissions),
      summary: controlSummary(rest),
      senebi: listSenebiToCharge(scoped),
      trading,
      total: rows.length,
      rows: rows.slice(0, limit),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al cargar control.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
