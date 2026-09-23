import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { renderToBuffer } from '@react-pdf/renderer';
import { QuotePdfDocument } from './quote-pdf';
import type { QuoteDocumentData } from './quote-types';

async function logoDataUri(configuredPath?: string | null) {
  if (!configuredPath) return null;
  const relative = configuredPath.replace(/^\/+/, '');
  const publicRoot = path.resolve(process.cwd(), 'public');
  const resolved = path.resolve(publicRoot, relative);
  if (!resolved.startsWith(`${publicRoot}${path.sep}`)) return null;
  try { const bytes = await readFile(resolved); const mime = /\.jpe?g$/i.test(resolved) ? 'image/jpeg' : 'image/png'; return `data:${mime};base64,${bytes.toString('base64')}`; } catch { return null; }
}

export async function renderQuotePdf(quote: QuoteDocumentData): Promise<Buffer> {
  return renderToBuffer(<QuotePdfDocument quote={quote} logoSource={await logoDataUri(quote.business.logo_asset_path)} />);
}
