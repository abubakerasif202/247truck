import type { JobStatus, QuoteStatus } from './types';

const QUOTE_TRANSITIONS: Readonly<Record<QuoteStatus, readonly QuoteStatus[]>> = {
  draft: ['sent', 'cancelled'],
  sent: ['accepted', 'declined', 'expired', 'cancelled'],
  accepted: ['converted_to_job', 'cancelled'],
  declined: [],
  expired: [],
  cancelled: [],
  converted_to_job: [],
};

const JOB_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  new: ['scheduled', 'in_progress', 'waiting', 'cancelled'],
  scheduled: ['in_progress', 'waiting', 'cancelled'],
  in_progress: ['waiting', 'cancelled'],
  waiting: ['scheduled', 'in_progress', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function canTransitionQuote(from: QuoteStatus, to: QuoteStatus): boolean {
  return QUOTE_TRANSITIONS[from].includes(to);
}

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}
