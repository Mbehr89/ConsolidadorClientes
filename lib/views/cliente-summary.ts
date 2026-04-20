import type { Position } from '@/lib/schema';

export interface ClienteSummary {
  cliente_id: string;
  titular: string;
  tipo_titular: 'persona' | 'juridica';
  cuentas: { broker: string; cuenta: string }[];
  brokers: string[];
  productores: string[];
  advisor: string | null;
  aum_usd: number;
  aum_by_broker: Record<string, number>;
  aum_by_clase: Record<string, number>;
  positions_count: number;
  warnings_count: number;
}

export function buildClienteSummaries(
  positions: Position[],
  advisorsByCliente: Record<string, string> = {}
): ClienteSummary[] {
  const map = new Map<string, ClienteSummary>();

  for (const p of positions) {
    let client = map.get(p.cliente_id);
    if (!client) {
      client = {
        cliente_id: p.cliente_id,
        titular: p.titular,
        tipo_titular: p.tipo_titular,
        cuentas: [],
        brokers: [],
        productores: [],
        advisor: advisorsByCliente[p.cliente_id]?.trim() || null,
        aum_usd: 0,
        aum_by_broker: {},
        aum_by_clase: {},
        positions_count: 0,
        warnings_count: 0,
      };
      map.set(p.cliente_id, client);
    }

    const usd = p.valor_mercado_usd ?? 0;
    client.aum_usd += usd;
    client.aum_by_broker[p.broker] = (client.aum_by_broker[p.broker] ?? 0) + usd;
    client.aum_by_clase[p.clase_activo] = (client.aum_by_clase[p.clase_activo] ?? 0) + usd;
    client.positions_count++;
    client.warnings_count += p.warnings.length;

    const cuentaKey = `${p.broker}:${p.cuenta}`;
    if (!client.cuentas.some((c) => `${c.broker}:${c.cuenta}` === cuentaKey)) {
      client.cuentas.push({ broker: p.broker, cuenta: p.cuenta });
    }
    if (!client.brokers.includes(p.broker)) {
      client.brokers.push(p.broker);
    }
    if (p.productor && !client.productores.includes(p.productor)) {
      client.productores.push(p.productor);
    }
  }

  return Array.from(map.values());
}
