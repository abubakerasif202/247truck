'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import type { OpeningStockImportActionState } from '@/app/(protected)/inventory/import/actions';
import type { OpeningStockPreview } from '@/lib/opening-stock/repository';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';

type ImportAction = (
  previous: OpeningStockImportActionState | undefined,
  formData: FormData,
) => Promise<OpeningStockImportActionState>;

function SubmitButton({ quantity, disabled }: { quantity: number; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-11" disabled={pending || disabled}>
      {pending ? 'Making stock live…' : `Make ${quantity} tyres live`}
    </Button>
  );
}

export function OpeningStockImportPanel({
  preview,
  sourceQuantity,
  sha256,
  action,
}: {
  preview: OpeningStockPreview;
  sourceQuantity: number;
  sha256: string;
  action: ImportAction;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const blocked = preview.ambiguousCount > 0;

  return (
    <div className="flex flex-col gap-5">
      <section className="operations-panel grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6">
        <Summary label="Product lines" value={`${preview.rows.length} product lines`} />
        <Summary label="Quantity" value={`${sourceQuantity} tyres`} />
        <Summary label="Location" value="Regency Park" />
        <Summary label="Condition" value="New" />
        <Summary label="Cost" value="Cost pending" warning />
        <Summary label="Selling price" value="Selling price pending" warning />
      </section>

      <section className="operations-panel flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Source verification</h2>
            <p className="text-xs text-muted-foreground">
              Fixed committed dataset · SHA-256 {sha256.slice(0, 12)}…
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="info">{preview.createCount} create</StatusBadge>
            <StatusBadge tone="success">{preview.matchCount} match</StatusBadge>
            {preview.ambiguousCount > 0 ? (
              <StatusBadge tone="danger">{preview.ambiguousCount} ambiguous</StatusBadge>
            ) : null}
          </div>
        </div>

        {blocked ? (
          <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            Import is blocked because one or more product identities are ambiguous. Resolve those product records first.
          </p>
        ) : null}

        <div className="hidden overflow-x-auto md:block">
          <table className="operations-table w-full text-sm">
            <thead className="bg-secondary/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Row</th>
                <th className="px-3 py-2">Brand</th>
                <th className="px-3 py-2">Pattern</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2">Match status</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={row.rowKey} className="border-t border-border">
                  <td className="px-3 py-2 text-muted-foreground">{row.rowNumber}</td>
                  <td className="px-3 py-2 font-medium">{row.brand}</td>
                  <td className="px-3 py-2">{row.pattern}</td>
                  <td className="px-3 py-2">{row.size}</td>
                  <td className="px-3 py-2 text-right font-semibold">{row.quantity}</td>
                  <td className="px-3 py-2">
                    <StatusBadge
                      tone={
                        row.matchStatus === 'ambiguous'
                          ? 'danger'
                          : row.matchStatus === 'match'
                            ? 'success'
                            : 'info'
                      }
                    >
                      {row.matchStatus === 'create'
                        ? 'Create product'
                        : row.matchStatus === 'match'
                          ? 'Match existing'
                          : 'Ambiguous'}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="flex flex-col gap-2 md:hidden">
          {preview.rows.map((row) => (
            <li key={row.rowKey} className="rounded-md border border-border bg-card p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{row.brand} {row.pattern}</p>
                  <p className="text-xs text-muted-foreground">Row {row.rowNumber} · {row.size}</p>
                </div>
                <span className="font-semibold">Qty {row.quantity}</span>
              </div>
              <div className="mt-2">
                <StatusBadge
                  tone={row.matchStatus === 'ambiguous' ? 'danger' : row.matchStatus === 'match' ? 'success' : 'info'}
                >
                  {row.matchStatus === 'create' ? 'Create product' : row.matchStatus === 'match' ? 'Match existing' : 'Ambiguous'}
                </StatusBadge>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <form action={formAction} className="operations-panel flex flex-col gap-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">Make confirmed opening stock live</h2>
          <p className="text-sm text-muted-foreground">
            This posts the confirmed quantities to live Regency Park inventory. Cost and
            selling price stay pending and are not treated as $0.
          </p>
        </div>
        <SubmitButton quantity={sourceQuantity} disabled={blocked} />
      </form>

      {state ? <ImportResult state={state} /> : null}
    </div>
  );
}

function Summary({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      {warning ? <StatusBadge tone="warning">{value}</StatusBadge> : <p className="font-semibold">{value}</p>}
    </div>
  );
}

function ImportResult({ state }: { state: OpeningStockImportActionState }) {
  const report = state.report;
  return (
    <section
      className={`operations-panel flex flex-col gap-3 border-l-4 p-4 ${state.ok ? 'border-l-success' : 'border-l-danger'}`}
      aria-live="polite"
    >
      <h2 className="text-sm font-semibold">{state.ok ? 'Opening stock import complete' : 'Opening stock import needs attention'}</h2>
      {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
      {report ? (
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-7">
          <ResultMetric label="Source rows" value={report.sourceRows} />
          <ResultMetric label="Source qty" value={report.sourceQuantity} />
          <ResultMetric label="Created" value={report.createdProducts} />
          <ResultMetric label="Matched" value={report.matchedProducts} />
          <ResultMetric label="Posted rows" value={report.postedRows} />
          <ResultMetric label="Posted qty" value={report.postedQuantity} />
          <ResultMetric label="Replayed" value={report.replayedRows} />
        </dl>
      ) : null}
      {report && report.errors.length > 0 ? (
        <ul className="list-disc pl-5 text-sm text-danger">
          {report.errors.map((error) => (
            <li key={`${error.rowNumber}-${error.rowKey}`}>
              Row {error.rowNumber}: {error.message}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ResultMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
