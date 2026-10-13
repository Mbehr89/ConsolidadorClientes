import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getStore, setStore, STORE_KEYS } from '@/lib/config-store';
import { parseLocalAuthUsers } from '@/lib/auth/local-users';
import { AppUserSchema, findUser, type AppUser } from '@/lib/auth/users';

const UsersSchema = z.array(AppUserSchema);
const SEED_DATE = '1970-01-01T00:00:00.000Z';

/** Usuarios de AUTH_LOCAL_USERS: lista inicial hasta el primer cambio desde el panel. */
function envUsers(): AppUser[] {
  return parseLocalAuthUsers(process.env.AUTH_LOCAL_USERS).map((u) => ({
    username: u.username,
    passwordHash: u.passwordHash,
    admin: u.admin,
    session_version: 0,
    created_at: SEED_DATE,
    updated_at: SEED_DATE,
    created_by: null,
  }));
}

export type UsersSource = 'store' | 'env';

/**
 * Los usuarios guardados desde el panel; si todavía no se guardó ninguno (o no se puede leer la config),
 * los de AUTH_LOCAL_USERS.
 */
export async function loadUsers(): Promise<{ users: AppUser[]; source: UsersSource }> {
  const stored = await getStore<AppUser[] | null>(STORE_KEYS.AUTH_USERS, UsersSchema.nullable(), null);
  if (stored) return { users: stored, source: 'store' };
  return { users: envUsers(), source: 'env' };
}

export async function getUser(username: string): Promise<AppUser | undefined> {
  return findUser((await loadUsers()).users, username);
}

export async function mutateUsers(fn: (users: AppUser[]) => AppUser[]): Promise<AppUser[]> {
  const { users } = await loadUsers();
  const next = fn(users);
  await setStore(STORE_KEYS.AUTH_USERS, UsersSchema, next);
  return next;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/** Usuario y contraseña correctos → el usuario; si no, null. */
export async function verifyCredentials(username: string, password: string): Promise<AppUser | null> {
  const user = await getUser(username);
  if (!user) return null;
  return (await bcrypt.compare(password, user.passwordHash)) ? user : null;
}
