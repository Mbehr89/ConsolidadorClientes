'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function DashboardPage() {
  return (
    <div className="page-shell max-w-5xl">
      <div className="page-header">
        <div>
          <h2 className="page-title">Dashboard</h2>
          <p className="page-subtitle">
          Consolidación de tenencias multi-broker
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Empezá subiendo archivos</CardTitle>
          <CardDescription>
            Subí los Excels de MS, Netx360, IEB y GMA para ver el consolidado.
            Todo se procesa en tu browser — los datos nunca salen de tu máquina.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/upload">
            <Button size="lg">Ir a Upload</Button>
          </Link>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Brokers soportados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Morgan Stanley</span>
              <span className="text-muted-foreground">Offshore US</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Netx360 (Pershing)</span>
              <span className="text-muted-foreground">Offshore US</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>IEB</span>
              <span className="text-muted-foreground">Local AR</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>GMA</span>
              <span className="text-muted-foreground">Local AR</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Seguridad</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>✓ Parseo 100% client-side (browser)</p>
            <p>✓ Archivos nunca se suben al servidor</p>
            <p>✓ Solo se persiste configuración (alias, grupos)</p>
            <p>✓ Auth con Google OAuth dominio restringido</p>
            <p>✓ HTTPS forzado, CSP, HSTS</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
