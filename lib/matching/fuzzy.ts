/**
 * Fuzzy matching para sugerencias de unificación de titulares.
 * NUNCA auto-merge. Solo genera sugerencias que el admin confirma en la UI.
 *
 * Usa Jaro-Winkler distance: score 0-1 donde 1 = idéntico.
 * Threshold default: 0.88 (conservador — prefiere falsos negativos a falsos positivos).
 */

const DEFAULT_THRESHOLD = 0.88;

/**
 * Jaro-Winkler similarity score entre dos strings.
 * Implementación directa sin deps externas.
 */
export function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const jaro = jaroDistance(s1, s2);

  // Winkler bonus: boost for common prefix up to 4 chars
  let prefixLen = 0;
  const maxPrefix = Math.min(4, Math.min(s1.length, s2.length));
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) {
      prefixLen++;
    } else {
      break;
    }
  }

  const p = 0.1; // Winkler scaling factor (standard)
  return jaro + prefixLen * p * (1 - jaro);
}

function jaroDistance(s1: string, s2: string): number {
  const maxDist = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;

  const s1Matches = new Array<boolean>(s1.length).fill(false);
  const s2Matches = new Array<boolean>(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matches
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - maxDist);
    const end = Math.min(i + maxDist + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  // Count transpositions
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (
    (matches / s1.length +
      matches / s2.length +
      (matches - transpositions / 2) / matches) /
    3
  );
}

// ─── Suggestion engine ──────────────────────────────────

export interface FuzzySuggestion {
  titular_a: string;
  titular_b: string;
  score: number;
}

/**
 * Dado un set de titulares normalizados, encuentra pares que podrían
 * ser el mismo cliente (score > threshold).
 * Devuelve sugerencias ordenadas por score desc.
 *
 * Complejidad O(n²) — aceptable para ~500 clientes máx.
 */
export function findFuzzyDuplicates(
  titulares: string[],
  threshold: number = DEFAULT_THRESHOLD
): FuzzySuggestion[] {
  const suggestions: FuzzySuggestion[] = [];
  const unique = [...new Set(titulares)];

  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const score = jaroWinkler(unique[i]!, unique[j]!);
      if (score >= threshold) {
        suggestions.push({
          titular_a: unique[i]!,
          titular_b: unique[j]!,
          score,
        });
      }
    }
  }

  return suggestions.sort((a, b) => b.score - a.score);
}
