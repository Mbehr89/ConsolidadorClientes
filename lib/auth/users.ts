import { z } from 'zod';

/** Usuario con contraseña de la app. La contraseña se guarda sólo como hash bcrypt. */
export const AppUserSchema = z.object({
  username: z.string().min(1).max(64),
  passwordHash: z.string().min(10),
  admin: z.boolean(),
  /** Sube al cambiar la contraseña: las sesiones abiertas con la anterior se cierran. */
  session_version: z.number().int().min(0),
  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.string().nullable(),
});
export type AppUser = z.infer<typeof AppUserSchema>;

export type PublicUser = Pick<AppUser, 'username' | 'admin' | 'created_at' | 'updated_at' | 'created_by'>;

export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt ignora lo que pasa de 72 bytes. */
export const PASSWORD_MAX_LENGTH = 72;
export const MAX_USERS = 50;

export class UserRuleError extends Error {}

export function sameUsername(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function findUser(users: readonly AppUser[], username: string): AppUser | undefined {
  return users.find((u) => sameUsername(u.username, username));
}

export function normalizeUsername(raw: string): string {
  const username = raw.trim().replace(/\s+/g, ' ');
  if (username.length < 2 || username.length > 40) {
    throw new UserRuleError('El usuario tiene que tener entre 2 y 40 caracteres.');
  }
  if (!/^[\p{L}\p{N} ._-]+$/u.test(username)) {
    throw new UserRuleError('El usuario sólo puede tener letras, números, espacios, punto, guion y guion bajo.');
  }
  return username;
}

export function validatePassword(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new UserRuleError(`La contraseña tiene que tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_LENGTH) {
    throw new UserRuleError('La contraseña es demasiado larga.');
  }
}

export function toPublicUser(u: AppUser): PublicUser {
  return {
    username: u.username,
    admin: u.admin,
    created_at: u.created_at,
    updated_at: u.updated_at,
    created_by: u.created_by,
  };
}

function requireUser(users: readonly AppUser[], username: string): AppUser {
  const user = findUser(users, username);
  if (!user) throw new UserRuleError(`No existe el usuario "${username}".`);
  return user;
}

function assertAdminsLeft(users: readonly AppUser[]) {
  if (!users.some((u) => u.admin)) throw new UserRuleError('Tiene que quedar al menos un administrador.');
}

export function addUser(
  users: readonly AppUser[],
  input: { username: string; passwordHash: string; admin: boolean },
  actor: string | null,
  now: string
): AppUser[] {
  const username = normalizeUsername(input.username);
  if (findUser(users, username)) throw new UserRuleError(`Ya existe el usuario "${username}".`);
  if (users.length >= MAX_USERS) throw new UserRuleError(`No se pueden tener más de ${MAX_USERS} usuarios.`);
  return [
    ...users,
    {
      username,
      passwordHash: input.passwordHash,
      admin: input.admin,
      session_version: 0,
      created_at: now,
      updated_at: now,
      created_by: actor,
    },
  ];
}

/** `actor`: usuario con contraseña que hace el cambio (null si entró con Google). */
export function updateUser(
  users: readonly AppUser[],
  username: string,
  changes: { passwordHash?: string; admin?: boolean },
  actor: string | null,
  now: string
): AppUser[] {
  const target = requireUser(users, username);
  if (changes.admin === false && actor && sameUsername(actor, target.username)) {
    throw new UserRuleError('No podés quitarte a vos mismo el rol de administrador.');
  }
  const next = users.map((u) =>
    u === target
      ? {
          ...u,
          ...(changes.admin != null ? { admin: changes.admin } : {}),
          ...(changes.passwordHash
            ? { passwordHash: changes.passwordHash, session_version: u.session_version + 1 }
            : {}),
          updated_at: now,
        }
      : u
  );
  assertAdminsLeft(next);
  return next;
}

export function removeUser(users: readonly AppUser[], username: string, actor: string | null): AppUser[] {
  const target = requireUser(users, username);
  if (actor && sameUsername(actor, target.username)) {
    throw new UserRuleError('No podés eliminar tu propio usuario.');
  }
  const next = users.filter((u) => u !== target);
  assertAdminsLeft(next);
  return next;
}
