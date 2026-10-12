'use client';

import type { DedupConflict } from '@/lib/aranceles/dedup';
import { formatDate, formatNumber } from '@/lib/aranceles/format';

/** Operaciones con un n° ya cargado pero datos distintos: no se importaron. */
export function ConflictList({ conflicts }: { conflicts: readonly DedupConflict[] }) {
  if (conflicts.length === 0) return null;
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted-foreground">
        Estos números de operación ya estaban en el historial con otros datos, o se repiten dentro del mismo archivo
        con datos distintos, así que no se importaron (ni se pisó lo anterior). Si el archivo nuevo es el correcto,
        borrá la importación anterior y volvé a sincronizar o subir este archivo.
      </p>
      <div className="max-h-64 overflow-auto rounded-md border border-border/70 bg-card">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="sticky top-0 border-b bg-card text-muted-foreground">
            <tr>
              <th className="p-2 text-left font-medium">N°</th>
              <th className="p-2 text-left font-medium">Fecha</th>
              <th className="p-2 text-left font-medium">Cliente</th>
              <th className="p-2 text-left font-medium">Qué cambia</th>
              <th className="p-2 text-right font-medium">Arancel cargado</th>
              <th className="p-2 text-right font-medium">Arancel nuevo</th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((c, i) => (
              <tr key={`${c.op_number}-${i}`} className="border-b border-border/50">
                <td className="p-2 font-mono tabular-nums">{c.op_number}</td>
                <td className="whitespace-nowrap p-2">{formatDate(c.trade_date)}</td>
                <td className="p-2">{c.client}</td>
                <td className="p-2">{c.differences.join(', ') || '—'}</td>
                <td className="p-2 text-right tabular-nums">{formatNumber(c.existing_commission)}</td>
                <td className="p-2 text-right tabular-nums">{formatNumber(c.incoming_commission)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
