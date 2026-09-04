export type QuoteStatus =
  | 'draft'
  | 'sent'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'cancelled'
  | 'converted_to_job';

export type JobStatus =
  | 'new'
  | 'scheduled'
  | 'in_progress'
  | 'waiting'
  | 'completed'
  | 'cancelled';

export type SalesLineType = 'product' | 'labour';

export type DocumentTotals = {
  subtotalExGstCents: number;
  gstCents: number;
  totalInclGstCents: number;
};
