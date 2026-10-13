import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth/options';

export type AdminActor = {
  /** Usuario con contraseña que hace el cambio; null si entró con Google. */
  username: string | null;
  label: string;
};

/** Sesión de administrador vigente, o la respuesta 401/403 para devolver. */
export async function requireAdmin(): Promise<{ actor: AdminActor } | { response: NextResponse }> {
  const session = await getServerSession(authOptions);
  if (!session || session.revoked) {
    return { response: NextResponse.json({ error: 'Tenés que iniciar sesión.' }, { status: 401 }) };
  }
  if (!session.isAdmin) {
    return { response: NextResponse.json({ error: 'Sólo un administrador puede hacer esto.' }, { status: 403 }) };
  }
  const email = session.user?.email ?? '';
  const local = email.endsWith('@local.auth');
  return {
    actor: {
      username: local ? (session.user?.name ?? null) : null,
      label: local ? (session.user?.name ?? 'admin') : email || 'admin',
    },
  };
}
