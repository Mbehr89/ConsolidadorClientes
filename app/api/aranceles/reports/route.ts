import { NextResponse } from 'next/server';
import { filterCommissions, listAlycs, listClients, listMonths } from '@/lib/aranceles/history';
import {
  buildBrokerPeriodReport,
  buildClientPeriodReport,
  parseGranularity,
  parseGroupBy,
} from '@/lib/aranceles/reports';
import { buildNetReport } from '@/lib/aranceles/net';
import { loadSegmentedHistory } from '@/lib/aranceles/segment-store';
import { coerceSettings } from '@/lib/aranceles/settings';
import {
  filterBySegment,
  parseSegmentFilters,
  segmentOptions,
  type SegmentedCommission,
} from '@/lib/aranceles/segments';
import type { CommissionFilters } from '@/lib/aranceles/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const filters: CommissionFilters = {
      alyc: sp.get('alyc') || null,
      client: sp.get('client') || null,
      from: sp.get('from') || null,
      to: sp.get('to') || null,
      q: sp.get('q') || null,
      feeStatus: null,
    };
    const granularity = parseGranularity(sp.get('granularity'));
    const groupBy = parseGroupBy(sp.get('groupBy'));
    const rawView = sp.get('view');
    const view = rawView === 'client' || rawView === 'net' ? rawView : 'broker';

    const { history, commissions } = await loadSegmentedHistory();
    const filtered = filterBySegment(filterCommissions(commissions, filters), parseSegmentFilters(sp));

    return NextResponse.json({
      importCount: history.imports.length,
      alycs: listAlycs(history),
      clients: listClients(history),
      months: listMonths(commissions),
      segmentOptions: segmentOptions(commissions),
      granularity,
      groupBy,
      report:
        view === 'client'
          ? buildClientPeriodReport(filtered, granularity)
          : view === 'net'
            ? buildNetReport(filtered, granularity, coerceSettings(history.settings), {
                personaOf: (c) => (c as SegmentedCommission).manager,
              })
            : buildBrokerPeriodReport(filtered, granularity, groupBy),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error al armar el reporte de aranceles.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
