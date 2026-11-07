'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/balances', label: 'Balance' },
  { href: '/balances/movimientos', label: 'Movimientos' },
] as const;

export default function BalancesLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="page-shell max-w-6xl">
      <div>
        <h2 className="page-title">Balances</h2>
        <p className="page-subtitle">
          El resultado de los grupos como el de una empresa, y el armado de socios, sueldos, gastos y tipo de cambio.
        </p>
      </div>
      <nav className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((tab) => {
          const active = tab.href === '/balances' ? pathname === tab.href : pathname.startsWith(tab.href);
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
