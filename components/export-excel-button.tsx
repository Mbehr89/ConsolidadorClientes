'use client';

import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { exportToExcel, type ExportOptions } from '@/lib/export/excel';
import type { Position } from '@/lib/schema';

export function ExportExcelButton({
  positions,
  options,
  disabled,
  label = 'Exportar Excel',
  variant = 'outline',
  size = 'default',
  className,
}: {
  positions: Position[];
  options?: ExportOptions;
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
      onClick={() => exportToExcel(positions, options)}
    >
      {label}
    </Button>
  );
}
