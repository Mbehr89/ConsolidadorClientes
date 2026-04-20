'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

function authBypassedInDev() {
  return (
    process.env.NODE_ENV === 'development' &&
    !process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID &&
    process.env.NEXT_PUBLIC_HAS_LOCAL_AUTH !== '1'
  );
}

function normalizeOAuthError(raw: string | null): string | null {
  if (raw == null) return null;
  const v = raw.trim();
  if (!v || v === 'undefined' || v === 'null') return null;
  return v;
}

function getErrorMessage(error: string | null): string | null {
  if (!error) return null;
  if (error === 'domain_not_allowed' || error === 'AccessDenied') {
    return 'Tu cuenta no pertenece al dominio autorizado para esta aplicacion.';
  }
  if (error === 'Configuration') {
    return 'Error de configuracion del servidor (NEXTAUTH_SECRET / NEXTAUTH_URL / OAuth). Revisá variables en Vercel y redeploy.';
  }
  if (error === 'OAuthSignin' || error === 'OAuthCallback') {
    return 'Fallo el callback de Google. Revisá en Google Cloud Console la URI de redireccion: /api/auth/callback/google para tu dominio.';
  }
  if (error === 'CredentialsSignin') {
    return 'Usuario o contraseña incorrectos.';
  }
  return `No se pudo iniciar sesion (codigo: ${error}). Intenta nuevamente o revisá logs en Vercel.`;
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-6 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl">Consolidador de Tenencias</CardTitle>
          <CardDescription>Cargando...</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}

function LoginPageInner() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';
  const error = getErrorMessage(normalizeOAuthError(searchParams.get('error')));

  const [authModes, setAuthModes] = useState<{ google: boolean; local: boolean } | null>(null);
  const [localUser, setLocalUser] = useState('');
  const [localPass, setLocalPass] = useState('');
  const [localLoading, setLocalLoading] = useState(false);
  const [credentialError, setCredentialError] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/auth/config', { cache: 'no-store' })
      .then((r) => r.json() as Promise<{ google: boolean; local: boolean }>)
      .then(setAuthModes)
      .catch(() => setAuthModes({ google: false, local: false }));
  }, []);

  useEffect(() => {
    if (authBypassedInDev()) {
      router.replace('/dashboard');
      return;
    }
    if (status === 'authenticated') {
      router.replace(callbackUrl);
    }
  }, [status, router, callbackUrl]);

  const onLocalSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setCredentialError(null);
      setLocalLoading(true);
      try {
        const res = await signIn('credentials', {
          username: localUser.trim(),
          password: localPass,
          callbackUrl,
          redirect: false,
        });
        if (res?.error) {
          setCredentialError('Usuario o contraseña incorrectos.');
          return;
        }
        if (res?.url) router.replace(res.url);
        else router.replace(callbackUrl);
      } finally {
        setLocalLoading(false);
      }
    },
    [callbackUrl, localPass, localUser, router]
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-6 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl sm:text-2xl">Consolidador de Tenencias</CardTitle>
          <CardDescription>
            {authModes?.google
              ? 'Ingresa con tu cuenta corporativa o usuario interno.'
              : authModes?.local
                ? 'Ingresa con usuario y contraseña.'
                : 'Cargando opciones de acceso...'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {authBypassedInDev() ? (
            <p className="text-sm text-muted-foreground">
              OAuth desactivado en desarrollo local (sin GOOGLE_CLIENT_ID ni AUTH_LOCAL_USERS).
            </p>
          ) : (
            <>
              {authModes?.google && (
                <Button className="h-11 w-full touch-manipulation sm:h-10" onClick={() => void signIn('google', { callbackUrl })}>
                  Ingresar con Google
                </Button>
              )}

              {authModes?.google && !authModes?.local && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-950">
                  Usuario/contraseña internos: falta <code className="font-mono text-[11px]">AUTH_LOCAL_USERS</code> en Vercel (Production) o el JSON es inválido. Un solo renglón; hashes con <code className="font-mono">$</code> sin <code className="font-mono">\</code>.
                </p>
              )}

              {authModes?.google && authModes?.local && (
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">o</span>
                  </div>
                </div>
              )}

              {authModes?.local && (
                <form onSubmit={onLocalSubmit} className="space-y-3">
                  <div>
                    <label htmlFor="local-user" className="mb-1 block text-sm font-medium">
                      Usuario
                    </label>
                    <input
                      id="local-user"
                      name="username"
                      autoComplete="username"
                      value={localUser}
                      onChange={(e) => setLocalUser(e.target.value)}
                      className="h-11 w-full rounded-md border bg-background px-3 text-base sm:h-10 sm:text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="local-pass" className="mb-1 block text-sm font-medium">
                      Contraseña
                    </label>
                    <input
                      id="local-pass"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      value={localPass}
                      onChange={(e) => setLocalPass(e.target.value)}
                      className="h-11 w-full rounded-md border bg-background px-3 text-base sm:h-10 sm:text-sm"
                      required
                    />
                  </div>
                  <Button type="submit" className="h-11 w-full touch-manipulation sm:h-10" disabled={localLoading}>
                    {localLoading ? 'Ingresando…' : 'Ingresar'}
                  </Button>
                </form>
              )}

              {authModes && !authModes.google && !authModes.local && (
                <p className="text-sm text-destructive">
                  No hay metodos de autenticacion configurados (GOOGLE_CLIENT_ID o AUTH_LOCAL_USERS).
                </p>
              )}
            </>
          )}
          {(error || credentialError) && (
            <p className="text-sm text-destructive">{error ?? credentialError}</p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
