/**
 * Config store — wrapper unificado.
 *
 * En desarrollo: usa un Map in-memory (no requiere Vercel KV).
 * En producción: usa @vercel/kv.
 *
 * Cada store es un key en KV con valor JSON validado por Zod.
 * Los datos son SOLO config (alias, grupos, tickers, mappings) — nunca PII ni tenencias.
 */
import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// ─── Store keys ─────────────────────────────────────────

export const STORE_KEYS = {
  ALIASES: 'config:aliases',
  GRUPOS: 'config:grupos',
  TICKERS_METADATA: 'config:tickers-metadata',
  TICKERS_PENDIENTES: 'config:tickers-pendientes',
  CLIENTE_ADVISORS: 'config:cliente-advisors',
  MAPPING_CUENTAS: 'config:mapping-cuentas',
  TIPO_CUENTA_MS: 'config:tipo-cuenta-ms',
  FX_DEFAULTS: 'config:fx-defaults',
  DRIVE_IMPORTED: 'config:drive-imported',
} as const;

// ─── In-memory store (dev) ──────────────────────────────

const memoryStore = new Map<string, unknown>();
const LOCAL_STORE_FILE = path.join(process.cwd(), '.local-store', 'config-store.json');

// ─── Generic get/set with Zod validation ────────────────

export async function getStore<T>(
  key: string,
  schema: z.ZodType<T>,
  defaultValue: T
): Promise<T> {
  try {
    if (isVercelKvAvailable()) {
      const { kv } = await import('@vercel/kv');
      const raw = await kv.get(key);
      if (raw == null) return defaultValue;
      return schema.parse(raw);
    }

    // Dev fallback: in-memory
    const diskStore = await readLocalStore();
    for (const [k, v] of Object.entries(diskStore)) memoryStore.set(k, v);
    const raw = memoryStore.get(key);
    if (raw == null) return defaultValue;
    return schema.parse(raw);
  } catch {
    console.error(`[config-store] Failed to read key: ${key}`);
    return defaultValue;
  }
}

export async function setStore<T>(
  key: string,
  schema: z.ZodType<T>,
  value: T
): Promise<void> {
  // Validate before writing
  const validated = schema.parse(value);

  try {
    if (isVercelKvAvailable()) {
      const { kv } = await import('@vercel/kv');
      await kv.set(key, validated);
      return;
    }

    // Dev fallback: in-memory
    memoryStore.set(key, validated);
    const current = await readLocalStore();
    current[key] = validated;
    await writeLocalStore(current);
  } catch (err) {
    console.error(`[config-store] Failed to write key: ${key}`, err);
    throw err;
  }
}

// ─── Helpers ────────────────────────────────────────────

function isVercelKvAvailable(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function readLocalStore(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(LOCAL_STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

async function writeLocalStore(value: Record<string, unknown>): Promise<void> {
  const dir = path.dirname(LOCAL_STORE_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(LOCAL_STORE_FILE, JSON.stringify(value, null, 2), 'utf8');
}

/**
 * Reset in-memory store (for tests).
 */
export function resetMemoryStore(): void {
  memoryStore.clear();
}
