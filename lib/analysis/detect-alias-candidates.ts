import type { BrokerCode, Position } from '@/lib/schema';
import { findFuzzyDuplicates } from '@/lib/matching/fuzzy';
import { resolveAlias } from '@/lib/matching/cliente-id';

export interface AliasCandidatePair {
  titular_a: string;
  titular_b: string;
  score: number;
  brokers_a: BrokerCode[];
  brokers_b: BrokerCode[];
}

/** Clave estable para un par (orden lexicográfico). */
export function aliasPairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

/**
 * Sugiere pares de titulares normalizados que podrían ser el mismo cliente.
 * Excluye pares ya unificados por alias (mismo resolveAlias) y pares ignorados.
 */
export function detectAliasCandidates(
  positions: Position[],
  aliases: Record<string, string>,
  ignoredPairKeys: ReadonlySet<string> = new Set(),
  threshold = 0.88
): AliasCandidatePair[] {
  const unique = [...new Set(positions.map((p) => p.titular_normalizado))];
  const brokerByTitular = new Map<string, Set<BrokerCode>>();

  for (const p of positions) {
    const t = p.titular_normalizado;
    let set = brokerByTitular.get(t);
    if (!set) {
      set = new Set();
      brokerByTitular.set(t, set);
    }
    set.add(p.broker);
  }

  const raw = findFuzzyDuplicates(unique, threshold);
  const out: AliasCandidatePair[] = [];

  for (const r of raw) {
    const a = r.titular_a;
    const b = r.titular_b;
    if (resolveAlias(a, aliases) === resolveAlias(b, aliases)) continue;
    if (ignoredPairKeys.has(aliasPairKey(a, b))) continue;

    out.push({
      titular_a: a,
      titular_b: b,
      score: r.score,
      brokers_a: sortBrokers(brokerByTitular.get(a) ?? new Set()),
      brokers_b: sortBrokers(brokerByTitular.get(b) ?? new Set()),
    });
  }

  return out;
}

function sortBrokers(s: Set<BrokerCode>): BrokerCode[] {
  return [...s].sort();
}
