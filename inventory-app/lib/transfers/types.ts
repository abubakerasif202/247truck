export type TransferStatus =
  | 'draft' | 'requested' | 'approved' | 'dispatched' | 'in_transit'
  | 'received' | 'completed' | 'rejected' | 'cancelled' | 'review_required';

export type TransferSummary = {
  id: string; transferNumber: string; sourceCode: string;
  destinationCode: string; status: TransferStatus; createdAt: string;
};

export type TransferDetail = {
  id: string; transfer_number: string; source_code: string; source_name: string;
  destination_code: string; destination_name: string; status: TransferStatus;
  notes: string | null; requested_by: string; requested_at: string | null;
  approved_at: string | null; dispatched_at: string | null; received_at: string | null;
  completed_at: string | null; discrepancy_notes: string | null;
  lines: Array<{
    id: string; product_id: string; requested_quantity: number;
    approved_quantity: number; dispatched_quantity: number; received_quantity: number;
    transfer_cost_snapshot: number | null;
  }>;
};
