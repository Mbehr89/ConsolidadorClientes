/**
 * Tests para lib/matching
 * Fixture-driven: cubre los casos reales de los 4 Excels analizados.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeTitular,
  detectJuridica,
  joinNetx360Name,
  isMsSociedadAccount,
  extractMsAccountPrefix,
  generateClienteIdSync,
  resolveAlias,
  jaroWinkler,
  findFuzzyDuplicates,
} from '@/lib/matching';

// ─── normalizeTitular ────────────────────────────────────

describe('normalizeTitular', () => {
  it('normaliza persona con formato "APELLIDO, NOMBRE"', () => {
    const r = normalizeTitular('BEHR, MILAGROS');
    expect(r.normalizado).toBe('MILAGROS BEHR');
    expect(r.tipo_titular).toBe('persona');
  });

  it('normaliza persona con formato "APELLIDO, NOMBRE SEGUNDO"', () => {
    const r = normalizeTitular('GONI, MARTIN IGNACIO');
    expect(r.normalizado).toBe('MARTIN IGNACIO GONI');
    expect(r.tipo_titular).toBe('persona');
  });

  it('normaliza persona sin coma (ya "NOMBRE APELLIDO")', () => {
    const r = normalizeTitular('Martinez Santiago Pablo');
    expect(r.normalizado).toBe('MARTINEZ SANTIAGO PABLO');
    expect(r.tipo_titular).toBe('persona');
  });

  it('strip acentos — ñ, tildes', () => {
    const r = normalizeTitular('GOÑI, MARTÍN');
    expect(r.normalizado).toBe('MARTIN GONI');
  });

  it('detecta jurídica por S.R.L. y no reordena', () => {
    const r = normalizeTitular('ADAPTO FUNGTASTIC S. R. L.');
    expect(r.tipo_titular).toBe('juridica');
    expect(r.normalizado).toBe('ADAPTO FUNGTASTIC SRL');
  });

  it('detecta jurídica por S.A.', () => {
    const r = normalizeTitular('LA VICTORIA GANADERA S. A.');
    expect(r.tipo_titular).toBe('juridica');
    expect(r.normalizado).toBe('LA VICTORIA GANADERA SA');
  });

  it('detecta jurídica por LIMITED', () => {
    const r = normalizeTitular('F1THOUSAND LIMITED');
    expect(r.tipo_titular).toBe('juridica');
    expect(r.normalizado).toBe('F1THOUSAND LTD');
  });

  it('no detecta jurídica en nombre normal', () => {
    const r = normalizeTitular('TENAGLIA, JORGE HERNAN');
    expect(r.tipo_titular).toBe('persona');
    expect(r.normalizado).toBe('JORGE HERNAN TENAGLIA');
  });

  it('maneja jurídica sin sufijo conocido como persona (sin flag manual)', () => {
    // FUNGALIA BLENDS no tiene sufijo societario
    const r = normalizeTitular('FUNGALIA BLENDS');
    expect(r.tipo_titular).toBe('persona'); // será overrideado por admin
    expect(r.normalizado).toBe('FUNGALIA BLENDS');
  });

  it('colapsa espacios múltiples', () => {
    const r = normalizeTitular('  LOPEZ   DAVIO ,  DELFINA  ');
    expect(r.normalizado).toBe('DELFINA LOPEZ DAVIO');
  });

  it('maneja string vacío', () => {
    const r = normalizeTitular('');
    expect(r.normalizado).toBe('');
    expect(r.tipo_titular).toBe('persona');
  });

  it('normaliza corporate Netx360 (solo first name, sin last)', () => {
    const r = normalizeTitular('WONDERGRAM');
    expect(r.normalizado).toBe('WONDERGRAM');
    expect(r.tipo_titular).toBe('persona'); // no tiene sufijo, admin classifica
  });
});

// ─── detectJuridica ──────────────────────────────────────

describe('detectJuridica', () => {
  const cases: [string, boolean][] = [
    ['ADAPTO FUNGTASTIC S. R. L.', true],
    ['LA VICTORIA GANADERA S.A.', true],
    ['F1THOUSAND LIMITED', true],
    ['WONDERGRAM', false],
    ['GRUPO FINANCIERO GALICIA SA', true],
    ['GL-SOCIEDAD', true],
    ['BEHR, MILAGROS', false],
    ['SOMETHING HOLDINGS LLC', true],
    ['CORP TECHNOLOGIES INC', true],
  ];

  it.each(cases)('detecta "%s" como juridica=%s', (input, expected) => {
    expect(detectJuridica(input.toUpperCase())).toBe(expected);
  });
});

// ─── joinNetx360Name ─────────────────────────────────────

describe('joinNetx360Name', () => {
  it('une first + last name normalmente', () => {
    expect(joinNetx360Name('JOSE', 'ASTARLOA')).toBe('JOSE ASTARLOA');
  });

  it('maneja last name compuesto', () => {
    expect(joinNetx360Name('AGUSTIN', 'NAVARRO DEL CANIZO')).toBe(
      'AGUSTIN NAVARRO DEL CANIZO'
    );
  });

  it('maneja corporate (last name vacío)', () => {
    expect(joinNetx360Name('WONDERGRAM', '')).toBe('WONDERGRAM');
    expect(joinNetx360Name('WONDERGRAM', null)).toBe('WONDERGRAM');
  });

  it('maneja corporate F1THOUSAND LIMITED (last name vacío)', () => {
    expect(joinNetx360Name('F1THOUSAND LIMITED', '')).toBe('F1THOUSAND LIMITED');
  });
});

// ─── MS helpers ──────────────────────────────────────────

describe('isMsSociedadAccount', () => {
  it('detecta -SOCIEDAD-', () => {
    expect(isMsSociedadAccount('GL-SOCIEDAD - 6838')).toBe(true);
    expect(isMsSociedadAccount('DL-SOCIEDAD - 6924')).toBe(true);
  });

  it('no detecta en cuentas normales', () => {
    expect(isMsSociedadAccount('MFR - 3815')).toBe(false);
    expect(isMsSociedadAccount('B-MFR - 3247')).toBe(false);
  });
});

describe('extractMsAccountPrefix', () => {
  it('extrae B- de B-MFR - 3247', () => {
    expect(extractMsAccountPrefix('B-MFR - 3247')).toBe('B-');
  });

  it('extrae B- de B-JKM - 3237', () => {
    expect(extractMsAccountPrefix('B-JKM - 3237')).toBe('B-');
  });

  it('devuelve "" para MFR - 3815 (sin prefijo de tipo)', () => {
    expect(extractMsAccountPrefix('MFR - 3815')).toBe('');
  });

  it('devuelve "" para GL-SOCIEDAD - 6838 (SOCIEDAD es tipo_titular)', () => {
    expect(extractMsAccountPrefix('GL-SOCIEDAD - 6838')).toBe('');
  });

  it('devuelve "" para JKM - 3612', () => {
    expect(extractMsAccountPrefix('JKM - 3612')).toBe('');
  });
});

// ─── cliente-id ──────────────────────────────────────────

describe('generateClienteIdSync', () => {
  it('produce hash determinístico', () => {
    const id1 = generateClienteIdSync('MARTIN IGNACIO GONI');
    const id2 = generateClienteIdSync('MARTIN IGNACIO GONI');
    expect(id1).toBe(id2);
    expect(id1).toHaveLength(12);
  });

  it('produce hashes distintos para nombres distintos', () => {
    const id1 = generateClienteIdSync('MARTIN IGNACIO GONI');
    const id2 = generateClienteIdSync('MARTIN GONI');
    expect(id1).not.toBe(id2);
  });

  it('resuelve alias antes de hashear', () => {
    const aliases = { 'MARTIN GONI': 'MARTIN IGNACIO GONI' };
    const id1 = generateClienteIdSync('MARTIN GONI', aliases);
    const id2 = generateClienteIdSync('MARTIN IGNACIO GONI');
    expect(id1).toBe(id2);
  });
});

describe('resolveAlias', () => {
  it('resuelve alias directo', () => {
    const aliases = { 'MARTIN GONI': 'MARTIN IGNACIO GONI' };
    expect(resolveAlias('MARTIN GONI', aliases)).toBe('MARTIN IGNACIO GONI');
  });

  it('devuelve original si no hay alias', () => {
    expect(resolveAlias('ALGO DESCONOCIDO', {})).toBe('ALGO DESCONOCIDO');
  });
});

// ─── Fuzzy matching ──────────────────────────────────────

describe('jaroWinkler', () => {
  it('idénticos = 1', () => {
    expect(jaroWinkler('MARTIN GONI', 'MARTIN GONI')).toBe(1);
  });

  it('completamente distintos = bajo', () => {
    expect(jaroWinkler('ABCDE', 'ZYXWV')).toBeLessThan(0.5);
  });

  it('variante con segundo nombre = alto', () => {
    const score = jaroWinkler('MARTIN GONI', 'MARTIN IGNACIO GONI');
    expect(score).toBeGreaterThan(0.85);
  });

  it('variante con typo = alto', () => {
    const score = jaroWinkler('JOSE ASTARLOA', 'JOSE ASTARL0A');
    expect(score).toBeGreaterThan(0.9);
  });

  it('nombres distintos = bajo', () => {
    const score = jaroWinkler('CARLOS MONTALDO', 'MARIA SAVAGE');
    expect(score).toBeLessThan(0.7);
  });
});

describe('findFuzzyDuplicates', () => {
  it('encuentra pares similares por encima del threshold', () => {
    const titulares = [
      'MARTIN GONI',
      'MARTIN IGNACIO GONI',
      'JOSE ASTARLOA',
      'CARLOS MONTALDO',
    ];
    const results = findFuzzyDuplicates(titulares, 0.85);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.titular_a).toContain('GONI');
    expect(results[0]!.titular_b).toContain('GONI');
  });

  it('no sugiere pares con threshold alto si son distintos', () => {
    const titulares = ['JOSE ASTARLOA', 'CARLOS MONTALDO', 'MARIA SAVAGE'];
    const results = findFuzzyDuplicates(titulares, 0.95);
    expect(results).toHaveLength(0);
  });
});
