'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ExportHistoryButton } from '@/components/aranceles/export-history-button';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/aranceles/neto', label: 'Totales Netos' },
  { href: '/aranceles', label: 'Resumen' },
  { href: '/aranceles/por-broker', label: 'Por broker' },
  { href: '/aranceles/por-cliente', label: 'Por cliente' },
  { href: '/aranceles/control', label: 'Control' },
  { href: '/aranceles/tarifas', label: 'Tarifas' },
  { href: '/aranceles/importar', label: 'Importar' },
  { href: '/aranceles/configuracion', label: 'Configuración' },
] as const;

export default function ArancelesLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="page-title">Aranceles ALYC</h2>
          <p className="page-subtitle">
            Comisiones que las ALYCs deben pagar por las operaciones de tus clientes. El historial se guarda en un JSON en
            Drive.
          </p>
        </div>
        <ExportHistoryButton />
      </div>
      <nav className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((tab) => {
          const active = tab.href === '/aranceles' ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
                active
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
