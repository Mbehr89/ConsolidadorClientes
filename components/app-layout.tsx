'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Database,
  Gauge,
  Grid3X3,
  Link2,
  LogOut,
  Menu,
  Settings2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: Grid3X3 },
  { href: '/upload', label: 'Upload', icon: Upload },
  { href: '/clientes', label: 'Clientes', icon: Users },
  { href: '/activos', label: 'Activos', icon: Database },
  { href: '/exposicion', label: 'Exposicion', icon: BarChart3 },
  { href: '/inconsistencias', label: 'Inconsistencias', icon: AlertTriangle },
] as const;

const ADMIN_ITEMS = [
  { href: '/admin/glosario', label: 'Glosario', icon: BookOpen, badge: 'glosario' as const },
  { href: '/admin/aliases', label: 'Aliases', icon: Link2 },
  { href: '/admin/grupos', label: 'Grupos', icon: Users },
  { href: '/admin/mapping-cuentas', label: 'Mapping Cuentas', icon: Settings2 },
  { href: '/admin/brokers', label: 'Brokers', icon: Gauge },
] as const;

function authBypassedInDev() {
  return (
    process.env.NODE_ENV === 'development' &&
    !process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID &&
    process.env.NEXT_PUBLIC_HAS_LOCAL_AUTH !== '1'
  );
}

function formatTodayEs(): string {
  return new Intl.DateTimeFormat('es', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
}

function formatTodayShortEs(): string {
  return new Intl.DateTimeFormat('es', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date());
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [glosarioPending, setGlosarioPending] = useState<number | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const todayLabel = useMemo(() => formatTodayEs(), []);
  const todayShort = useMemo(() => formatTodayShortEs(), []);

  const isAdmin = useMemo(() => {
    if (authBypassedInDev()) return true;
    return Boolean(session?.isAdmin);
  }, [session?.isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const load = () => {
      fetch('/api/config/tickers-pendientes/pending-count')
        .then((r) => r.json())
        .then((d: { count?: number }) => {
          if (!cancelled && typeof d.count === 'number') setGlosarioPending(d.count);
        })
        .catch(() => {
          if (!cancelled) setGlosarioPending(0);
        });
    };
    load();
    window.addEventListener('glosario-pending-updated', load);
    return () => {
      cancelled = true;
      window.removeEventListener('glosario-pending-updated', load);
    };
  }, [isAdmin]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen]);

  const navLinkClass = (active: boolean) =>
    cn(
      'flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-[13px] font-normal transition-colors duration-[120ms] lg:min-h-0 lg:py-2',
      active
        ? 'bg-white/[0.12] text-white font-medium'
        : 'text-white/[0.65] hover:bg-white/[0.08] hover:text-white/[0.92]'
    );

  return (
    <div className="flex min-h-screen bg-background">
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Cerrar menu"
          className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px] lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside
        className={cn(
          'flex w-[min(18rem,88vw)] shrink-0 flex-col bg-navy-700 px-5 py-6 pl-[max(1.25rem,env(safe-area-inset-left,0px))] text-white transition-transform duration-200 ease-out',
          'fixed inset-y-0 left-0 z-50 lg:relative lg:z-0 lg:w-60 lg:translate-x-0',
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="flex h-12 items-center justify-between gap-2">
          <h1 className="text-base font-semibold tracking-tight text-white">Consolidador</h1>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0 touch-manipulation text-white hover:bg-white/10 lg:hidden"
            aria-label="Cerrar menu"
            onClick={() => setMobileNavOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        <p className="text-[11px] text-white/45">Portfolio intelligence</p>

        <div className="my-4 h-px bg-white/10" />

        <p className="mb-2 px-3 text-[10px] font-medium uppercase tracking-wider text-white/35">Principal</p>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-auto">
          {NAV_ITEMS.map((item) => (
            <Link key={item.href} href={item.href} className={navLinkClass(pathname === item.href)}>
              <item.icon
                className={cn('h-4 w-4 shrink-0', pathname === item.href ? 'opacity-100' : 'opacity-70')}
                aria-hidden
              />
              {item.label}
            </Link>
          ))}

          {isAdmin && (
            <>
              <div className="pt-4 pb-2">
                <p className="px-3 text-[10px] font-medium uppercase tracking-wider text-white/35">Admin</p>
              </div>

              {ADMIN_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={navLinkClass(pathname.startsWith(item.href))}
                >
                  <item.icon
                    className={cn(
                      'h-4 w-4 shrink-0',
                      pathname.startsWith(item.href) ? 'opacity-100' : 'opacity-70'
                    )}
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                    <span className="truncate">{item.label}</span>
                    {'badge' in item && item.badge === 'glosario' && glosarioPending != null && glosarioPending > 0 && (
                      <Badge variant="destructive" className="h-5 min-w-[1.25rem] shrink-0 justify-center px-1.5 py-0 text-[10px]">
                        {glosarioPending > 99 ? '99+' : glosarioPending}
                      </Badge>
                    )}
                  </span>
                </Link>
              ))}
            </>
          )}
        </nav>

        <div className="mt-auto space-y-3 border-t border-white/10 pt-5">
          {session?.user ? (
            <div className="space-y-1 px-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-white/95">{session.user.name ?? 'Usuario'}</p>
                {isAdmin && (
                  <Badge variant="outline" className="border-white/35 bg-transparent text-[10px] text-white">
                    Admin
                  </Badge>
                )}
              </div>
              <p className="truncate text-xs text-white/55">{session.user.email}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 w-full border-white/25 bg-transparent text-white hover:bg-white/[0.08] hover:text-white"
                onClick={() => void signOut({ callbackUrl: '/login' })}
              >
                <LogOut className="mr-1.5 h-3.5 w-3.5" />
                Cerrar sesion
              </Button>
            </div>
          ) : (
            <p className="px-1 text-xs text-white/55">
              {authBypassedInDev() ? 'Auth desactivada en desarrollo local.' : 'Sin sesion activa.'}
            </p>
          )}
          <p className="px-1 text-[11px] text-white/40">Tenencias: parseo principalmente en el cliente.</p>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="flex h-[56px] shrink-0 items-center gap-2 border-b-[0.5px] border-border bg-background px-3 sm:h-[60px] sm:px-5 lg:px-10 pt-[max(0.25rem,env(safe-area-inset-top,0px))]">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0 touch-manipulation lg:hidden"
            aria-label="Abrir menu"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-caption">Workspace</p>
              <p className="truncate text-sm font-medium text-foreground">Consolidado de tenencias</p>
            </div>
            <time
              className="hidden shrink-0 text-label capitalize text-muted-foreground lg:block"
              dateTime={new Date().toISOString().slice(0, 10)}
            >
              {todayLabel}
            </time>
            <time
              className="max-w-[42%] shrink-0 text-right text-[11px] leading-tight text-muted-foreground lg:hidden"
              dateTime={new Date().toISOString().slice(0, 10)}
            >
              {todayShort}
            </time>
          </div>
        </header>

        <main className="flex-1 overflow-auto overflow-x-hidden">
          <div className="p-4 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] sm:p-6 lg:p-8 lg:px-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
