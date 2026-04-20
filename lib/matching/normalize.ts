/**
 * Normalización determinística de titulares.
 * Produce un string canónico a partir del nombre como lo reporta cada broker.
 *
 * Flujo:
 * 1. uppercase
 * 2. strip acentos
 * 3. detectar persona vs jurídica
 * 4. si persona y tiene coma → reorden "APELLIDO, NOMBRE" → "NOMBRE APELLIDO"
 * 5. eliminar puntuación residual
 * 6. colapsar espacios
 *
 * Este módulo es PURO (sin side effects). No accede a stores.
 */

// ─── Sufijos societarios para detección de jurídicas ────

const SUFIJOS_JURIDICOS = [
  // AR
  'S\\.?\\s*A\\.?',
  'S\\.?\\s*R\\.?\\s*L\\.?',
  'S\\.?\\s*A\\.?\\s*S\\.?',
  'S\\.?\\s*A\\.?\\s*U\\.?',
  'S\\.?\\s*C\\.?\\s*A\\.?',
  // US / global
  'LTD\\.?',
  'LIMITED',
  'INC\\.?',
  'INCORPORATED',
  'CORP\\.?',
  'CORPORATION',
  'LLC',
  'L\\.?L\\.?C\\.?',
  'LP',
  'L\\.?P\\.?',
  'HOLDINGS?',
  'GROUP',
  'TRUST',
  'FUND',
  'FOUNDATION',
  // Otros
  'SOCIEDAD',
  'GMBH',
  'PLC',
  'NV',
  'BV',
  'AG',
];

const JURIDICA_REGEX = new RegExp(
  `\\b(${SUFIJOS_JURIDICOS.join('|')})\\b`,
  'i'
);

// ─── Accent stripping map ───────────────────────────────

const ACCENT_MAP: Record<string, string> = {
  'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U',
  'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u',
  'Ñ': 'N', 'ñ': 'n',
  'Ü': 'U', 'ü': 'u',
  'Ä': 'A', 'ä': 'a', 'Ö': 'O', 'ö': 'o',
};

function stripAccents(s: string): string {
  return s.replace(/[^\x00-\x7F]/g, (char) => ACCENT_MAP[char] ?? char);
}

// ─── Core normalize ─────────────────────────────────────

export interface NormalizeResult {
  normalizado: string;
  tipo_titular: 'persona' | 'juridica';
}

/**
 * Normaliza un nombre de titular.
 * No hace fuzzy matching ni lookup de alias — eso es responsabilidad
 * de alias-resolver.ts que corre después.
 */
export function normalizeTitular(raw: string): NormalizeResult {
  let s = raw.trim();
  if (s === '') return { normalizado: '', tipo_titular: 'persona' };

  // Uppercase first
  s = s.toUpperCase();

  // Strip acentos
  s = stripAccents(s);

  // Detect jurídica
  const esJuridica = detectJuridica(s);

  if (!esJuridica) {
    // Reordenar "APELLIDO, NOMBRE" → "NOMBRE APELLIDO"
    const commaIdx = s.indexOf(',');
    if (commaIdx > 0) {
      const apellido = s.slice(0, commaIdx).trim();
      const nombre = s.slice(commaIdx + 1).trim();
      if (nombre.length > 0) {
        s = `${nombre} ${apellido}`;
      }
    }
  } else {
    // Para jurídicas: limpiar sufijos de puntuación inconsistente
    s = cleanJuridicaSuffix(s);
  }

  // Eliminar puntuación residual (preservar guiones y apóstrofos que son parte de nombres)
  s = s.replace(/[.,;:!?()[\]{}'"]/g, ' ');

  // Colapsar espacios
  s = s.replace(/\s+/g, ' ').trim();

  return {
    normalizado: s,
    tipo_titular: esJuridica ? 'juridica' : 'persona',
  };
}

/**
 * Detecta si un nombre corresponde a una persona jurídica.
 * Heurística: busca sufijos societarios conocidos.
 */
export function detectJuridica(uppercased: string): boolean {
  return JURIDICA_REGEX.test(uppercased);
}

/**
 * Normaliza sufijos societarios para matching consistente.
 * "S. R. L." → "SRL", "S.A." → "SA", "LIMITED" → "LTD", etc.
 */
function cleanJuridicaSuffix(s: string): string {
  return s
    .replace(/S\.\s*R\.\s*L\.?/g, 'SRL')
    .replace(/S\.\s*A\.\s*S\.?/g, 'SAS')
    .replace(/S\.\s*A\.\s*U\.?/g, 'SAU')
    .replace(/S\.\s*A\.?/g, 'SA')
    .replace(/S\.\s*C\.\s*A\.?/g, 'SCA')
    .replace(/\bLIMITED\b/g, 'LTD')
    .replace(/\bINCORPORATED\b/g, 'INC')
    .replace(/\bCORPORATION\b/g, 'CORP')
    .replace(/L\.\s*L\.\s*C\.?/g, 'LLC')
    .replace(/L\.\s*P\.?/g, 'LP');
}

// ─── Netx360 specific: join First + Last name ───────────

/**
 * Une First Name y Last Name de Netx360.
 * Maneja corporates (Last Name vacío) y nombres compuestos.
 */
export function joinNetx360Name(firstName: string | null, lastName: string | null): string {
  const first = (firstName ?? '').trim();
  const last = (lastName ?? '').trim();

  if (last === '') {
    // Corporate: "WONDERGRAM", "F1THOUSAND LIMITED"
    return first;
  }

  // Persona: "NOMBRE APELLIDO"
  return `${first} ${last}`.trim();
}

// ─── MS specific: detect -SOCIEDAD suffix ───────────────

/**
 * Detecta si una cuenta MS tiene sufijo -SOCIEDAD (auto-set juridica).
 */
export function isMsSociedadAccount(accountNumber: string): boolean {
  return /SOCIEDAD/i.test(accountNumber);
}

/**
 * Extrae el prefijo de tipo de cuenta de MS.
 * "B-MFR - 3247" → "B-"
 * "MFR - 3815" → ""
 * "GL-SOCIEDAD - 6838" → "" (SOCIEDAD es tipo_titular, no tipo_cuenta)
 */
export function extractMsAccountPrefix(accountNumber: string): string {
  // Remove -SOCIEDAD first (it's tipo_titular, not tipo_cuenta)
  const cleaned = accountNumber.replace(/-?SOCIEDAD/i, '');
  // Match leading prefix like "B-", "LAL-", etc.
  const m = cleaned.match(/^([A-Z]+-)/);
  if (!m) return '';

  const prefix = m[1]!;
  // Verify it's a type prefix (1-3 chars before dash), not the account holder code
  // Account holder codes like "MFR-", "JKM-" are 3+ chars and are the main identifier
  // Type prefixes are typically 1-2 chars: "B-", "L-", "LAL-"
  // Heuristic: if the prefix is also the start of the full code → it's the holder, not the type
  // E.g., "MFR - 3815" → "MFR-" is the holder code, not a type prefix
  // "B-MFR - 3247" → "B-" is the type, "MFR" is the holder
  const afterPrefix = cleaned.slice(prefix.length).trim();
  const hasHolderCodeAfter = /^[A-Z]{2,}/.test(afterPrefix);

  return hasHolderCodeAfter ? prefix : '';
}
