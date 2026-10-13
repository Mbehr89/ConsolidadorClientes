import { describe, expect, it } from 'vitest';
import {
  UserRuleError,
  addUser,
  normalizeUsername,
  removeUser,
  toPublicUser,
  updateUser,
  validatePassword,
  type AppUser,
} from '@/lib/auth/users';

const NOW = '2026-10-13T12:00:00.000Z';

function user(username: string, admin: boolean): AppUser {
  return {
    username,
    passwordHash: `hash-${username}-0123456789`,
    admin,
    session_version: 0,
    created_at: NOW,
    updated_at: NOW,
    created_by: null,
  };
}

const base = [user('Ana', true), user('Beto', false)];

describe('usuarios de la app', () => {
  it('crea usuarios con nombre válido y sin repetir (sin distinguir mayúsculas)', () => {
    const next = addUser(base, { username: '  Carla  Paz ', passwordHash: 'hash-carla-0123', admin: false }, 'Ana', NOW);
    expect(next.map((u) => u.username)).toEqual(['Ana', 'Beto', 'Carla Paz']);
    expect(next[2]).toMatchObject({ admin: false, session_version: 0, created_by: 'Ana' });
    expect(() => addUser(base, { username: 'ana', passwordHash: 'x'.repeat(20), admin: false }, null, NOW)).toThrow(
      UserRuleError
    );
    expect(() => normalizeUsername('a')).toThrow(UserRuleError);
    expect(() => normalizeUsername('pepe<script>')).toThrow(UserRuleError);
    expect(normalizeUsername('Martín')).toBe('Martín');
  });

  it('exige contraseñas de al menos 8 caracteres', () => {
    expect(() => validatePassword('corta')).toThrow(UserRuleError);
    expect(() => validatePassword('Mirage89')).not.toThrow();
    expect(() => validatePassword('x'.repeat(73))).toThrow(UserRuleError);
  });

  it('cambiar la contraseña invalida las sesiones abiertas; cambiar el rol no', () => {
    const withPassword = updateUser(base, 'beto', { passwordHash: 'hash-nuevo-0123' }, 'Ana', NOW);
    expect(withPassword[1]).toMatchObject({ passwordHash: 'hash-nuevo-0123', session_version: 1 });
    const promoted = updateUser(base, 'Beto', { admin: true }, 'Ana', NOW);
    expect(promoted[1]).toMatchObject({ admin: true, session_version: 0 });
  });

  it('siempre queda un administrador y nadie se borra ni se degrada a sí mismo', () => {
    expect(() => updateUser(base, 'Ana', { admin: false }, 'Ana', NOW)).toThrow(/vos mismo/);
    expect(() => updateUser(base, 'Ana', { admin: false }, null, NOW)).toThrow(/al menos un administrador/);
    expect(() => removeUser(base, 'Ana', 'Ana')).toThrow(/propio usuario/);
    expect(() => removeUser(base, 'Ana', null)).toThrow(/al menos un administrador/);
    expect(removeUser(base, 'beto', 'Ana').map((u) => u.username)).toEqual(['Ana']);
    expect(() => removeUser(base, 'Nadie', 'Ana')).toThrow(/No existe/);
  });

  it('lo que se muestra en el panel no incluye el hash', () => {
    expect(Object.keys(toPublicUser(base[0]!))).not.toContain('passwordHash');
  });
});
