import { describe, expect, it } from 'vitest';

import type { UserAccessContext } from '../../lib/auth/types';
import type { PurchaseOrderStatus } from '../../lib/purchasing/types';
import * as purchasingQueries from '../../lib/purchasing/queries';

function access(
  role: 'admin' | 'manager',
  permissions: UserAccessContext['permissions'],
): UserAccessContext {
  return {
    userId: `${role}-user`,
    role,
    locationId: role === 'manager' ? 'lon-id' : null,
    locationCode: role === 'manager' ? 'LON' : null,
    permissions,
  };
}

function actionFlags(user: UserAccessContext, status: PurchaseOrderStatus) {
  const fn = (
    purchasingQueries as typeof purchasingQueries & {
      getPurchaseOrderActionFlags?: (
        access: UserAccessContext,
        status: PurchaseOrderStatus,
      ) => {
        canEdit: boolean;
        canSubmit: boolean;
        canApprove: boolean;
        canReject: boolean;
        canMarkSent: boolean;
        canCancel: boolean;
      };
    }
  ).getPurchaseOrderActionFlags;

  if (!fn) throw new Error('getPurchaseOrderActionFlags is not implemented.');
  return fn(user, status);
}

function mapSummary(user: UserAccessContext, orderedTotal: number | null) {
  const fn = (
    purchasingQueries as typeof purchasingQueries & {
      mapPurchaseOrderSummaryRow?: (
        row: Record<string, unknown>,
        access: UserAccessContext,
      ) => { orderedTotal: number | null };
    }
  ).mapPurchaseOrderSummaryRow;

  if (!fn) throw new Error('mapPurchaseOrderSummaryRow is not implemented.');
  return fn(
    {
      purchase_order_id: 'po-id',
      po_number: 'LON-PO-000001',
      location_id: 'lon-id',
      location_code: 'LON',
      supplier_id: 'supplier-id',
      supplier_name: 'Supplier',
      status: 'draft',
      created_at: '2026-09-03T00:00:00.000Z',
      ordered_total: orderedTotal,
      ordered_quantity: 4,
      outstanding_quantity: 4,
    },
    user,
  );
}

describe('purchase order UI policy', () => {
  it('never exposes approve or reject actions to Managers', () => {
    const manager = access(
      'manager',
      new Set(['purchasing.view', 'purchasing.create_po', 'purchasing.submit_po']),
    );

    expect(actionFlags(manager, 'submitted')).toMatchObject({
      canApprove: false,
      canReject: false,
    });
  });

  it('exposes approve and reject to Admin only while submitted', () => {
    const admin = access('admin', new Set());

    expect(actionFlags(admin, 'submitted')).toMatchObject({
      canApprove: true,
      canReject: true,
    });
    expect(actionFlags(admin, 'approved')).toMatchObject({
      canApprove: false,
      canReject: false,
    });
  });

  it('lets a permitted Manager edit and submit draft and rejected POs', () => {
    const manager = access(
      'manager',
      new Set(['purchasing.view', 'purchasing.create_po', 'purchasing.submit_po']),
    );

    for (const status of ['draft', 'rejected'] as const) {
      expect(actionFlags(manager, status)).toMatchObject({
        canEdit: true,
        canSubmit: true,
        canApprove: false,
        canReject: false,
      });
    }
  });

  it('only exposes mark-sent to Admin for approved POs', () => {
    const admin = access('admin', new Set());
    const manager = access('manager', new Set(['purchasing.view']));

    expect(actionFlags(admin, 'approved').canMarkSent).toBe(true);
    expect(actionFlags(admin, 'sent').canMarkSent).toBe(false);
    expect(actionFlags(manager, 'approved').canMarkSent).toBe(false);
  });

  it('never exposes cancellation for received, closed or already cancelled POs', () => {
    const admin = access('admin', new Set());

    for (const status of ['partially_received', 'received', 'closed', 'cancelled'] as const) {
      expect(actionFlags(admin, status).canCancel).toBe(false);
    }
  });

  it('defensively removes ordered cost when view-cost permission is missing', () => {
    const manager = access('manager', new Set(['purchasing.view']));
    expect(mapSummary(manager, 501.25).orderedTotal).toBeNull();
  });

  it('keeps ordered cost for Admin and explicit view-cost permission', () => {
    const admin = access('admin', new Set());
    const manager = access(
      'manager',
      new Set(['purchasing.view', 'inventory.view_cost']),
    );

    expect(mapSummary(admin, 501.25).orderedTotal).toBe(501.25);
    expect(mapSummary(manager, 501.25).orderedTotal).toBe(501.25);
  });
});
