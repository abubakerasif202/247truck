import type { LocationCode } from '../app-config';

export type UserRole = 'admin' | 'manager';

export type PermissionKey =
  | 'inventory.view'
  | 'inventory.stock_in'
  | 'inventory.stock_out'
  | 'inventory.adjust'
  | 'inventory.view_cost'
  | 'inventory.edit_global_price'
  | 'inventory.transfer_request'
  | 'purchasing.view'
  | 'purchasing.create_po'
  | 'purchasing.submit_po'
  | 'purchasing.receive_po'
  | 'reports.view_inventory_value'
  | 'customers.view'
  | 'customers.create'
  | 'customers.edit'
  | 'customers.manage_contacts'
  | 'customers.manage_vehicles'
  | 'quotes.view'
  | 'quotes.create'
  | 'quotes.edit'
  | 'quotes.accept'
  | 'jobs.view'
  | 'jobs.create'
  | 'jobs.edit'
  | 'jobs.complete'
  | 'pos.use'
  | 'invoices.view'
  | 'invoices.create'
  | 'invoices.edit'
  | 'invoices.issue'
  | 'invoices.cancel'
  | 'payments.view'
  | 'payments.record'
  | 'payments.reverse'
  | 'payments.reconcile'
  | 'refunds.create'
  | 'receivables.view'
  | 'discounts.apply'
  | 'documents.send';

export interface UserAccessContext {
  userId: string;
  role: UserRole;
  locationId: string | null;
  locationCode: LocationCode | null;
  permissions: ReadonlySet<PermissionKey>;
}
