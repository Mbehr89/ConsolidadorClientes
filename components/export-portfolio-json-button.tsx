'use client';

import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { exportPortfolioJson, type ExportOptions } from '@/lib/export/excel';
import type { Position } from '@/lib/schema';

/** Misma data que el Excel “informe completo”; solo cambia el formato de salida. */
export function ExportPortfolioJsonButton({
  positions,
  options,
  disabled,
  label = 'Exportar JSON',
  variant = 'outline',
  size = 'default',
  className,
}: {
  positions: Position[];
  options?: Pick<ExportOptions, 'filename' | 'fxUsdArs' | 'bondFlowViewMode'>;
  disabled?: boolean;
  label?: string;
  variant?: ComponentProps<typeof Button>['variant'];
  size?: ComponentProps<typeof Button>['size'];
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={disabled || positions.length === 0}
      onClick={() =>
        void exportPortfolioJson(positions, {
          filename: options?.filename?.replace(/\.xlsx$/i, ''),
          fxUsdArs: options?.fxUsdArs ?? null,
          bondFlowViewMode: options?.bondFlowViewMode ?? 'normal',
        })
      }
    >
      {label}
    </Button>
  );
}
