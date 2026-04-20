import AppLayout from '@/components/app-layout';
import { ConsolidationProvider } from '@/lib/context/consolidation-context';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ConsolidationProvider>
      <AppLayout>{children}</AppLayout>
    </ConsolidationProvider>
  );
}
