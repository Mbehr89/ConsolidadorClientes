import { AdminOnly } from '@/components/admin-only';

export default function BrokersPage() {
  return (
    <AdminOnly>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Configuracion de Brokers</h2>
        <p className="text-muted-foreground mt-1">Proximamente - metadata y ajustes de parsers</p>
      </div>
    </AdminOnly>
  );
}
