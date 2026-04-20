'use client';

import { Suspense, useEffect } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

function authBypassedInDev() {
  return process.env.NODE_ENV === 'development' && !process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
}

function getErrorMessage(error: string | null): string | null {
  if (!error) return null;
  if (error === 'domain_not_allowed' || error === 'AccessDenied') {
    return 'Tu cuenta no pertenece al dominio autorizado para esta aplicacion.';
  }
  return 'No se pudo iniciar sesion. Intenta nuevamente.';
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
    <main className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Consolidador de Tenencias</CardTitle>
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
  const error = getErrorMessage(searchParams.get('error'));

  useEffect(() => {
    if (authBypassedInDev()) {
      router.replace('/dashboard');
      return;
    }
    if (status === 'authenticated') {
      router.replace(callbackUrl);
    }
  }, [status, router, callbackUrl]);

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Consolidador de Tenencias</CardTitle>
          <CardDescription>Ingresa con tu cuenta corporativa para acceder al panel.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {authBypassedInDev() ? (
            <p className="text-sm text-muted-foreground">
              OAuth desactivado en desarrollo local (GOOGLE_CLIENT_ID vacio).
            </p>
          ) : (
            <Button className="w-full" onClick={() => void signIn('google', { callbackUrl })}>
              Ingresar con Google
            </Button>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </main>
  );
}
