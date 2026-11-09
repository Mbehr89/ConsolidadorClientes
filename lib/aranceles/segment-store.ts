import { segmentCommissions, type SegmentedCommission } from '@/lib/aranceles/segments';
import { coerceSettings } from '@/lib/aranceles/settings';
import { loadHistory } from '@/lib/aranceles/store';
import type { ArancelesHistory } from '@/lib/aranceles/types';
import { GRUPOS_ASESOR } from '@/lib/grupo-asesor';
import { getGruposAsesor, getMappingCuentas } from '@/lib/config-store/accessors';

/** Historial + manager / advisor / grupo asesor de cada operación según el mapping de cuentas actual. */
export async function loadSegmentedHistory(): Promise<{
  history: ArancelesHistory;
  commissions: SegmentedCommission[];
}> {
  const [history, mapping, gruposAsesor] = await Promise.all([
    loadHistory(),
    getMappingCuentas().catch(() => null),
    getGruposAsesor().catch(() => [...GRUPOS_ASESOR]),
  ]);
  return {
    history,
    commissions: segmentCommissions(history.commissions, mapping, coerceSettings(history.settings), gruposAsesor),
  };
}
