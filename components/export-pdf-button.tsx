'use client';

import { useState } from 'react';
import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { exportToPdf, type PdfOptions } from '@/lib/export/pdf';
import type { Position } from '@/lib/schema';

export function ExportPdfButton({
  positions,
  clienteId,
  options,
  disabled,
  label = 'Exportar PDF',
  variant = 'outline',
  size = 'default',
  className,
}: {
  positions: Position[];
  /** Si se informa, refuerza el subtítulo cuando el book es de un solo cliente */
  clienteId?: string;
  options?: PdfOptions;
  disabled?: boolean;
  label?: string;
  variant?: ComponentProps<typeof Button>['variant'];
  size?: ComponentProps<typeof Button>['size'];
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={disabled || positions.length === 0 || busy}
      onClick={async () => {
        setBusy(true);
        try {
          await exportToPdf(positions, clienteId, options);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? 'Generando…' : label}
    </Button>
  );
}
