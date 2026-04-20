/**
 * Genera cliente_id estable a partir del titular normalizado.
 * 
 * Pipeline:
 * 1. Buscar en alias store si hay un nombre canónico para esta variante
 * 2. Normalizar el resultado (o el original si no hay alias)
 * 3. SHA-256 truncado a 12 chars hex
 *
 * 12 chars hex = 48 bits = ~281 trillion combinaciones.
 * Para ~500 clientes la probabilidad de colisión es ~4.4e-10 (despreciable).
 */

/**
 * Genera un hash determinístico de un string.
 * Usa SubtleCrypto (browser) o crypto (Node).
 * Devuelve hex truncado a `length` chars.
 */
export async function hashString(input: string, length: number = 12): Promise<string> {
  // Browser environment
  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    return hashHex.slice(0, length);
  }

  // Node.js fallback
  const { createHash } = await import('crypto');
  const hash = createHash('sha256').update(input).digest('hex');
  return hash.slice(0, length);
}

/**
 * Resuelve alias: si el nombre normalizado tiene un alias canónico,
 * devuelve ese. Si no, devuelve el original.
 */
export function resolveAlias(
  normalizado: string,
  aliases: Record<string, string>
): string {
  // Lookup directo
  const canonical = aliases[normalizado];
  if (canonical) return canonical;

  // No hay alias → devolver original
  return normalizado;
}

/**
 * Pipeline completo: nombre crudo → cliente_id estable.
 */
export async function generateClienteId(
  normalizado: string,
  aliases: Record<string, string> = {}
): Promise<string> {
  const resolved = resolveAlias(normalizado, aliases);
  return hashString(resolved);
}

/**
 * Versión sincrónica para contextos donde async no es práctico.
 * Usa un hash simple (djb2) — menos seguro pero determinístico.
 * Usar SOLO en tests o como fallback temporal.
 */
export function generateClienteIdSync(
  normalizado: string,
  aliases: Record<string, string> = {}
): string {
  const resolved = resolveAlias(normalizado, aliases);
  return djb2Hash(resolved);
}

function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  // Convert to unsigned hex, pad to 12 chars
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  // Extend to 12 chars by hashing again with offset
  let hash2 = 5381;
  for (let i = 0; i < str.length; i++) {
    hash2 = ((hash2 << 5) + hash2 + str.charCodeAt(i) + 1) & 0xffffffff;
  }
  const hex2 = (hash2 >>> 0).toString(16).padStart(8, '0');
  return (hex + hex2).slice(0, 12);
}
