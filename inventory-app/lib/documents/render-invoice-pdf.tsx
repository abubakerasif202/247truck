import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { renderToBuffer } from '@react-pdf/renderer';

import { InvoicePdfDocument } from './invoice-pdf';
import type { InvoiceDocumentData } from './invoice-types';

async function logoDataUri(configuredPath?: string | null): Promise<string | null> {
  const relative = (configuredPath || '/brand/logo-real-horizontal.png').replace(/^\/+/, '');
  const publicRoot = path.resolve(process.cwd(), 'public');
  const resolved = path.resolve(publicRoot, relative);
  if (!resolved.startsWith(`${publicRoot}${path.sep}`)) return null;
  try {
    const bytes = await readFile(resolved);
    const mime = path.extname(resolved).toLowerCase() === '.jpg' || path.extname(resolved).toLowerCase() === '.jpeg' ? 'image/jpeg' : 'image/png';
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function renderInvoicePdf(invoice: InvoiceDocumentData): Promise<Buffer> {
  const logo = await logoDataUri(invoice.business.logo_asset_path);
  return renderToBuffer(<InvoicePdfDocument invoice={invoice} logoSource={logo} />);
}
