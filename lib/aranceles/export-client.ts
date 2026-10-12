import React from 'react';
import { exportFilename, type ClientExportData } from '@/lib/aranceles/export-model';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function downloadClientExcel(data: ClientExportData): Promise<void> {
  const { exportClientArancelesExcel } = await import('./export-excel');
  downloadBlob(await exportClientArancelesExcel(data), exportFilename(data.client, 'xlsx'));
}

export async function downloadClientPdf(data: ClientExportData): Promise<void> {
  const [{ pdf }, { ClientArancelesPdf }, logo] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./export-pdf'),
    fetchAsDataUrl('/behr-advisory-header.png'),
  ]);
  const el = React.createElement(ClientArancelesPdf, { data, logo });
  const blob = await pdf(el as Parameters<typeof pdf>[0]).toBlob();
  downloadBlob(blob, exportFilename(data.client, 'pdf'));
}
