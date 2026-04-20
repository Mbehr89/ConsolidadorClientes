'use client';

import { useSession } from 'next-auth/react';

function authBypassedInDev() {
  return (
    process.env.NODE_ENV === 'development' &&
    !process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID &&
    process.env.NEXT_PUBLIC_HAS_LOCAL_AUTH !== '1'
  );
}

export function AdminOnly({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();

  if (authBypassedInDev()) {
    return <>{children}</>;
  }

  if (status === 'loading') {
    return <p className="text-sm text-muted-foreground">Validando permisos...</p>;
  }

  if (!session?.isAdmin) {
    return (
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">Seccion Admin</h2>
        <p className="text-muted-foreground">No tenes permisos para acceder a esta seccion.</p>
      </div>
    );
  }

  return <>{children}</>;
}
