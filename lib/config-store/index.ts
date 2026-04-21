/**
 * Config store — wrapper unificado.
 *
 * En desarrollo: usa un Map in-memory (no requiere Vercel KV).
 * En producción: usa @vercel/kv, @upstash/redis (REST) o redis:// directo.
 *
 * Cada store es un key remoto con valor JSON validado por Zod.
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
    const backend = getRemoteBackend();
    if (backend !== 'none') {
      const raw = await remoteGet(key, backend);
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
    const backend = getRemoteBackend();
    if (backend !== 'none') {
      await remoteSet(key, validated, backend);
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

type RemoteBackend = 'vercel-kv' | 'upstash-redis' | 'redis-url' | 'none';

function firstNonEmpty(...values: Array<string | undefined>): string | null {
  for (const v of values) {
    if (v && v.trim()) return v.trim();
  }
  return null;
}

function getUpstashRestCredentials(): { url: string; token: string } | null {
  const url = firstNonEmpty(
    process.env.UPSTASH_REDIS_REST_URL,
    process.env.UPSTASH_REDIS_REST_REDIS_URL,
    process.env.REDIS_URL
  );
  const token = firstNonEmpty(
    process.env.UPSTASH_REDIS_REST_TOKEN,
    process.env.UPSTASH_REDIS_REST_REDIS_TOKEN,
    process.env.REDIS_TOKEN,
    process.env.REDIS_REST_TOKEN
  );
  if (!url || !token) return null;
  return { url, token };
}

function getRedisUrlDirect(): string | null {
  const raw = process.env.REDIS_URL?.trim();
  if (!raw) return null;
  return raw;
}

function getRemoteBackend(): RemoteBackend {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return 'vercel-kv';
  }
  if (getUpstashRestCredentials()) {
    return 'upstash-redis';
  }
  if (getRedisUrlDirect()) {
    return 'redis-url';
  }
  return 'none';
}

async function remoteGet(key: string, backend: Exclude<RemoteBackend, 'none'>): Promise<unknown> {
  if (backend === 'vercel-kv') {
    const { kv } = await import('@vercel/kv');
    return kv.get(key);
  }
  if (backend === 'redis-url') {
    return remoteGetRedisUrl(key);
  }

  const { Redis } = await import('@upstash/redis');
  const creds = getUpstashRestCredentials();
  if (!creds) return null;
  const redis = new Redis({
    url: creds.url,
    token: creds.token,
  });
  return redis.get(key);
}

async function getRedisDirectClient() {
  const url = getRedisUrlDirect();
  if (!url) return null;

  const g = globalThis as typeof globalThis & {
    __configStoreRedisClient?: Promise<{
      get: (key: string) => Promise<string | null>;
      set: (key: string, value: string) => Promise<unknown>;
    }>;
  };

  if (!g.__configStoreRedisClient) {
    g.__configStoreRedisClient = (async () => {
      const { createClient } = await import('redis');
      const client = createClient({ url });
      client.on('error', (err) => {
        console.error('[config-store] Redis client error', err);
      });
      await client.connect();
      return client;
    })();
  }

  return g.__configStoreRedisClient;
}

async function remoteSet(
  key: string,
  value: unknown,
  backend: Exclude<RemoteBackend, 'none'>
): Promise<void> {
  if (backend === 'vercel-kv') {
    const { kv } = await import('@vercel/kv');
    await kv.set(key, value);
    return;
  }
  if (backend === 'redis-url') {
    await remoteSetRedisUrl(key, value);
    return;
  }

  const { Redis } = await import('@upstash/redis');
  const creds = getUpstashRestCredentials();
  if (!creds) return;
  const redis = new Redis({
    url: creds.url,
    token: creds.token,
  });
  await redis.set(key, value);
}

async function remoteGetRedisUrl(key: string): Promise<unknown> {
  const client = await getRedisDirectClient();
  if (!client) return null;
  const raw = await client.get(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function remoteSetRedisUrl(key: string, value: unknown): Promise<void> {
  const client = await getRedisDirectClient();
  if (!client) return;
  await client.set(key, JSON.stringify(value));
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
