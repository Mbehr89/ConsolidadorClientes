import { z } from 'zod';

const EntrySchema = z.object({
  username: z.string().min(1).max(64),
  /** bcrypt hash, ej. $2a$10$... */
  passwordHash: z.string().min(10),
  admin: z.boolean(),
});

export type LocalAuthEntry = z.infer<typeof EntrySchema>;

const ListSchema = z.array(EntrySchema).min(1).max(10);

/**
 * JSON en AUTH_LOCAL_USERS, una sola línea o multilínea en Vercel.
 * Ej: [{"username":"admin","passwordHash":"$2a$10$...","admin":true},...]
 */
/**
 * En .env.local los hashes usan `\$` para evitar que dotenv se coma los `$`; eso produce JSON inválido
 * si se copia tal cual a Vercel. Normalizamos antes de parsear.
 */
function normalizeAuthLocalUsersJson(raw: string): string {
  return raw.replace(/^\uFEFF/, '').replace(/\\\$/g, '$');
}

export function parseLocalAuthUsers(raw: string | undefined): LocalAuthEntry[] {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(normalizeAuthLocalUsersJson(trimmed)) as unknown;
    return ListSchema.parse(parsed);
  } catch {
    console.error('[auth] AUTH_LOCAL_USERS invalid JSON or schema');
    return [];
  }
}

export function isLocalAuthConfigured(): boolean {
  return parseLocalAuthUsers(process.env.AUTH_LOCAL_USERS).length > 0;
}
