'use client';

import { Copy, Eye, EyeOff, KeyRound, RefreshCw, Trash2, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AdminOnly } from '@/components/admin-only';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { PublicUser } from '@/lib/auth/users';

const PASSWORD_MIN_LENGTH = 8;
const INPUT = 'h-9 rounded-md border bg-background px-2 text-sm';

type UsersResponse = { users: PublicUser[]; source: 'store' | 'env'; me: string | null; error?: string };

function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8)].map((g) => g.join('')).join('-');
}

function formatDate(iso: string): string {
  if (iso.startsWith('1970')) return '—';
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function PasswordInput({
  value,
  onChange,
  id,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        autoComplete="new-password"
        className={`${INPUT} w-48 font-mono`}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        title="Generar una contraseña"
        onClick={() => {
          onChange(generatePassword());
          setVisible(true);
        }}
      >
        <RefreshCw className="mr-1 h-3.5 w-3.5" />
        Generar
      </Button>
    </div>
  );
}

export default function UsuariosPage() {
  const [data, setData] = useState<UsersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ username: string; password: string } | null>(null);
  const [newUser, setNewUser] = useState({ username: '', password: '', admin: false });
  const [editing, setEditing] = useState<{ username: string; password: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/users', { cache: 'no-store' });
      const json = (await res.json()) as UsersResponse;
      if (!res.ok) throw new Error(json.error ?? 'No se pudieron cargar los usuarios');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const send = useCallback(async (method: 'POST' | 'PATCH' | 'DELETE', body: object): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as UsersResponse;
      if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar el cambio');
      setData(json);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const create = async () => {
    const username = newUser.username.trim();
    if (!username) return setError('Completá el usuario.');
    if (newUser.password.length < PASSWORD_MIN_LENGTH) {
      return setError(`La contraseña tiene que tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
    }
    if (await send('POST', newUser)) {
      setNotice({ username, password: newUser.password });
      setNewUser({ username: '', password: '', admin: false });
    }
  };

  const savePassword = async () => {
    if (!editing) return;
    if (editing.password.length < PASSWORD_MIN_LENGTH) {
      return setError(`La contraseña tiene que tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
    }
    if (await send('PATCH', { username: editing.username, password: editing.password })) {
      setNotice({ username: editing.username, password: editing.password });
      setEditing(null);
    }
  };

  const isMe = (u: PublicUser) => data?.me != null && data.me.toLowerCase() === u.username.toLowerCase();

  return (
    <AdminOnly>
      <div className="max-w-5xl space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Usuarios</h2>
          <p className="mt-1 text-muted-foreground">
            Usuarios que entran con usuario y contraseña. Las contraseñas se guardan cifradas: no se pueden ver,
            sólo reemplazar por una nueva.
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {notice && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-teal-400/50 bg-teal-100/60 px-3 py-2 text-sm dark:bg-teal-600/15">
            <span>
              Contraseña de <span className="font-semibold">{notice.username}</span>:{' '}
              <span className="font-mono font-semibold">{notice.password}</span>
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void navigator.clipboard.writeText(notice.password)}
            >
              <Copy className="mr-1 h-3.5 w-3.5" />
              Copiar
            </Button>
            <span className="text-xs text-muted-foreground">Pasásela ahora: después no se puede volver a ver.</span>
            <button
              type="button"
              className="ml-auto text-xs text-muted-foreground underline"
              onClick={() => setNotice(null)}
            >
              Ocultar
            </button>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Nuevo usuario</CardTitle>
            <CardDescription>
              Los administradores además ven la sección Admin (glosario, aliases, mapping de cuentas, usuarios).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <div>
                <label htmlFor="new-username" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Usuario
                </label>
                <input
                  id="new-username"
                  autoComplete="off"
                  className={`${INPUT} w-48`}
                  value={newUser.username}
                  onChange={(e) => setNewUser((u) => ({ ...u, username: e.target.value }))}
                  placeholder="ej. Martin"
                />
              </div>
              <div>
                <label htmlFor="new-password" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Contraseña (mínimo {PASSWORD_MIN_LENGTH})
                </label>
                <PasswordInput
                  id="new-password"
                  value={newUser.password}
                  onChange={(password) => setNewUser((u) => ({ ...u, password }))}
                />
              </div>
              <label className="flex h-9 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={newUser.admin}
                  onChange={(e) => setNewUser((u) => ({ ...u, admin: e.target.checked }))}
                />
                Administrador
              </label>
              <Button type="submit" disabled={busy}>
                <UserPlus className="mr-1.5 h-4 w-4" />
                Crear usuario
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Usuarios ({data?.users.length ?? 0})</CardTitle>
            <CardDescription>
              Quien entra con Google no figura acá: es administrador si su mail está en la variable ADMIN_EMAILS de
              Vercel.
              {data?.source === 'env' &&
                ' Por ahora se usan los usuarios de la variable AUTH_LOCAL_USERS; con el primer cambio pasan a guardarse acá.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!data ? (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            ) : (
              <div className="overflow-auto rounded-md border">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr className="text-xs text-muted-foreground">
                      <th className="p-2 text-left font-medium">Usuario</th>
                      <th className="p-2 text-left font-medium">Rol</th>
                      <th className="p-2 text-left font-medium">Creado</th>
                      <th className="p-2 text-left font-medium">Último cambio</th>
                      <th className="p-2 text-right font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((u) => (
                      <tr key={u.username} className="border-b border-border/40 align-top">
                        <td className="p-2 font-medium">
                          {u.username}
                          {isMe(u) && <span className="ml-1 text-xs font-normal text-muted-foreground">(vos)</span>}
                        </td>
                        <td className="p-2">
                          {u.admin ? <Badge>Administrador</Badge> : <Badge variant="outline">Usuario</Badge>}
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">
                          {formatDate(u.created_at)}
                          {u.created_by && <div>por {u.created_by}</div>}
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">{formatDate(u.updated_at)}</td>
                        <td className="p-2">
                          {editing?.username === u.username ? (
                            <form
                              className="flex flex-wrap items-center justify-end gap-2"
                              onSubmit={(e) => {
                                e.preventDefault();
                                void savePassword();
                              }}
                            >
                              <PasswordInput
                                autoFocus
                                value={editing.password}
                                onChange={(password) => setEditing({ username: u.username, password })}
                              />
                              <Button type="submit" size="sm" disabled={busy}>
                                Guardar
                              </Button>
                              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                                Cancelar
                              </Button>
                            </form>
                          ) : confirmDelete === u.username ? (
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <span className="text-xs">¿Eliminar a {u.username}?</span>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                disabled={busy}
                                onClick={() =>
                                  void send('DELETE', { username: u.username }).then(() => setConfirmDelete(null))
                                }
                              >
                                Eliminar
                              </Button>
                              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                                Cancelar
                              </Button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap justify-end gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => {
                                  setConfirmDelete(null);
                                  setEditing({ username: u.username, password: '' });
                                }}
                              >
                                <KeyRound className="mr-1 h-3.5 w-3.5" />
                                Nueva contraseña
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busy || (u.admin && isMe(u))}
                                title={u.admin && isMe(u) ? 'No podés quitarte a vos mismo el rol de administrador' : undefined}
                                onClick={() => void send('PATCH', { username: u.username, admin: !u.admin })}
                              >
                                {u.admin ? 'Quitar admin' : 'Hacer admin'}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="text-destructive"
                                disabled={busy || isMe(u)}
                                title={isMe(u) ? 'No podés eliminar tu propio usuario' : undefined}
                                onClick={() => {
                                  setEditing(null);
                                  setConfirmDelete(u.username);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Al cambiar la contraseña o eliminar un usuario, su sesión abierta se cierra en menos de un minuto.
            </p>
          </CardContent>
        </Card>
      </div>
    </AdminOnly>
  );
}
