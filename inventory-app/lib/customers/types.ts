export type CustomerType = 'individual' | 'business';
export type PaymentTerms = 'due_on_receipt' | '7_days' | '14_days' | '30_days';
export type VehicleType = 'truck' | 'trailer' | 'other';
export type CustomerFilter = 'all' | CustomerType | 'active' | 'archived';

export type CustomerSummary = {
  id: string; customerNumber: string; customerType: CustomerType; displayName: string;
  phone: string | null; paymentTerms: PaymentTerms; active: boolean; vehicleCount: number;
};

export type CustomerContact = {
  id: string; customer_id: string; first_name: string; last_name: string | null;
  role_title: string | null; mobile: string | null; phone: string | null; email: string | null;
  primary_contact: boolean; billing_contact: boolean; notes: string | null; active: boolean; version: number;
};

export type CustomerVehicle = {
  id: string; customer_id: string; vehicle_type: VehicleType; registration: string;
  fleet_number: string | null; make: string | null; model: string | null; year: number | null;
  vin: string | null; body_description: string | null; axle_configuration_notes: string | null;
  tyre_notes: string | null; notes: string | null; active: boolean; version: number;
};

export type CustomerDetail = {
  id: string; customer_number: string; customer_type: CustomerType; display_name: string;
  first_name: string | null; last_name: string | null; company_name: string | null; legal_name: string | null;
  abn: string | null; mobile: string | null; phone: string | null; email: string | null;
  billing_email: string | null; accounts_email: string | null; street_address: string | null;
  suburb: string; state: string; postcode: string; payment_terms: PaymentTerms;
  po_reference_required: boolean; notes: string | null; active: boolean; version: number;
  contacts: CustomerContact[]; vehicles: CustomerVehicle[];
};

export const PAYMENT_TERM_LABELS: Record<PaymentTerms, string> = {
  due_on_receipt: 'Due on Receipt', '7_days': '7 Days', '14_days': '14 Days', '30_days': '30 Days',
};
