const salePermissions = ['pos.order.create', 'pos.payment.process'];
const reportPermissions = new Map([
  ['overview', 'sales'], ['channels', 'sales'], ['items', 'items'], ['transactions', 'transactions'],
  ['discounts', 'discounts'], ['refunds', 'refunds'], ['payments', 'payments'], ['shifts', 'shifts'],
]);

export function accountStaffAccess(identity, tenantId, locationId, required) {
  if (!required && !Object.hasOwn(identity, 'staffAccess')) return undefined;
  if (identity.device || !Array.isArray(identity.staffAccess)) return null;
  const scope = identity.staffAccess.find(entry => entry?.tenantId === tenantId);
  if (!locationId || !scope?.locations?.includes(locationId) || !Array.isArray(scope.permissions)) return null;
  return new Set(scope.permissions);
}

export function permitsStaffRequest({ permissions, mode, path, method, query, body }) {
  const has = key => permissions.has(key);
  const read = method === 'GET' || method === 'HEAD';
  if (mode === 'CDS') {
    return has('applications.cds') && read && ['/me', '/display', '/display/terminals'].includes(path);
  }
  const pos = has('applications.pos');
  const dashboard = mode !== 'POS' && has('applications.dashboard');
  if (!pos && !dashboard) return false;
  if (path === '/me' || path === '/logout') return true;

  if (path === '/display' || path === '/display/revision') {
    return pos && (read || method === 'POST') &&
      (!(body?.discountId || body?.partnerDiscountMinor) || has('pos.discount.apply'));
  }
  if (path === '/orders' && method === 'POST') {
    if (!pos || !salePermissions.every(has)) return false;
    const discounted = body?.discountId || body?.partnerOrderDiscountMinor ||
      (Array.isArray(body?.items) && body.items.some(line => line?.itemDiscountMinor));
    return !discounted || has('pos.discount.apply');
  }
  if (path === '/orders/resolve-pending') return pos && has('pos.payment.change');
  if (path === '/orders' || path.startsWith('/orders/')) {
    return read && ((pos && has('pos.order.create')) || (dashboard && has('reporting.transactions')));
  }
  if (path === '/shift') return (pos && has('pos.order.create')) || (dashboard && has('reporting.shifts'));
  if (path === '/shift/open') return pos && has('pos.shift.open');
  if (path === '/shift/close') {
    return pos && has('pos.shift.close') && (!body?.movements?.length || has('pos.cash.manage'));
  }
  if (path === '/refunds') return read ? dashboard && has('reporting.refunds') : pos && has('pos.refund.process');
  if (path === '/payment-corrections') return pos && has('pos.payment.change');
  if (path.startsWith('/approvals')) return pos && (has('pos.refund.request') || has('pos.refund.process') || has('pos.payment.change'));
  if (path === '/managers') return pos;
  if (path === '/manager-pin') return pos && has('administration.staff');

  if (path === '/reports' || path.startsWith('/reports/')) {
    const permission = reportPermissions.get(query.get('type') || 'overview');
    return read && dashboard && Boolean(permission) && has('reporting.' + permission) &&
      (!path.endsWith('/export') || has('reporting.export'));
  }
  if (path.startsWith('/shift-analytics')) return dashboard && has('reporting.shifts') &&
    (path !== '/shift-analytics/margins' || has('reporting.profitability'));
  if (path.startsWith('/shift-expense-receipt/') || path.startsWith('/expenses')) {
    return dashboard && has('operations.expenses');
  }
  if (path.startsWith('/recipe-costing')) return dashboard && has('operations.recipes') && has('operations.costing');
  if (path.startsWith('/shift-reconciliation')) return (pos || dashboard) && (has('operations.closing.reconcile') || read && has('operations.closing.financial')) &&
    (!path.endsWith('/report') || has('operations.closing.financial'));
  if (path.startsWith('/stock-control')) {
    const parts = path.slice('/stock-control/'.length).split('/');
    const resource = parts[0], action = parts[2];
    if (resource === 'purchases' && read) return (pos || dashboard) &&
      (has('operations.stock.purchase') || has('operations.stock.receive'));
    const permission = resource === 'settings' ? read ? 'operations.stock.count' : 'operations.stock.configure'
      : resource === 'items' || resource === 'schedules' ? read ? 'operations.stock.count' : 'operations.stock.configure'
      : resource === 'counts' ? read ? null : 'operations.stock.count'
      : resource === 'variance' ? 'operations.stock.variance'
      : resource === 'movements' ? read ? 'operations.stock.history'
        : body?.kind === 'receipt' ? 'operations.stock.receive' : body?.kind === 'waste' ? 'operations.stock.waste' : 'operations.stock.adjust'
      : resource === 'requisitions' ? action === 'approve' || action === 'reject' ? 'operations.stock.approve' : read ? null : 'operations.stock.requisition'
      : resource === 'purchases' ? action === 'receive' ? 'operations.stock.receive' : 'operations.stock.purchase'
      : null;
    return (resource === 'settings' && read
      ? has('operations.stock.count') || has('operations.stock.configure')
      : resource === 'schedules' && read
      ? has('operations.stock.count') || has('operations.stock.configure')
      : resource === 'counts' && read
      ? ['operations.stock.count','operations.stock.history','operations.stock.variance'].some(has)
      : resource === 'items' && read
      ? ['operations.stock.count','operations.stock.requisition','operations.stock.configure','operations.stock.history','operations.stock.variance'].some(has)
      : resource === 'requisitions' && read
      ? has('operations.stock.requisition') || has('operations.stock.approve')
      : Boolean(permission) && has(permission)) && (pos || dashboard);
  }
  if (path.startsWith('/purchasing')) return dashboard && has(path.startsWith('/purchasing/suppliers') ? 'operations.suppliers' : 'operations.purchasing');
  if (path.startsWith('/food-model')) {
    const permission = ['ingredients', 'suppliers', 'purchasing', 'inventory'].find(key => path.startsWith('/food-model/' + key));
    return dashboard && (permission ? has('operations.' + (permission === 'ingredients' ? 'purchasing' : permission))
      : has('operations.recipes') && has('operations.costing'));
  }
  if (path.startsWith('/modifier-groups') || path.startsWith('/modifier-options/') || path.endsWith('/modifier-groups')) {
    return (read && pos) || (dashboard && has('operations.modifiers'));
  }
  if (path.startsWith('/products') || path.startsWith('/categories') || path.startsWith('/images') ||
      path === '/menu-layout' || path === '/menu-availability-audit') {
    const cost = /(?:cost|price-options)/.test(path);
    if (cost) return dashboard && has('operations.costing');
    return (read && pos && path !== '/menu-availability-audit') || has('operations.menu');
  }
  if (path.startsWith('/sales-channels')) return (read && pos) || (dashboard && has('administration.business'));
  if (path.startsWith('/discount-catalog')) {
    return (read && pos) || (dashboard && has('administration.business'));
  }
  if (path.startsWith('/print/')) {
    const checkoutPrint = ['/print/native-jobs', '/print/native-receipt', '/print/native-test', '/print/native-printer', '/print/policy', '/print/payment-request', '/print/order'].includes(path);
    return (pos && checkoutPrint && (path !== '/print/policy' || read)) || has('administration.printers');
  }
  if (path.startsWith('/users')) return dashboard && has('administration.staff');
  if (path.startsWith('/onboarding')) return dashboard && has('administration.business');
  if (path === '/kds-config' || path.startsWith('/kds-outbox')) return dashboard && has('administration.devices');
  return false;
}
