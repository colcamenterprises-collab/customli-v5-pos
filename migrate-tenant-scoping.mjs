// Prepare tenant columns without assigning historical sales to the current process tenant.
// Historical attribution requires verified ownership of the rows.
export function migrateTenantScoping(db) {
  const tenantId = process.env.PLATFORM_TENANT_ID;
  if (!tenantId) {
    console.warn('PLATFORM_TENANT_ID not set; skipping tenant schema installation');
    return;
  }

  const tables = [
    'products', 'categories', 'shifts', 'orders', 'order_items',
    'refunds', 'payment_corrections', 'shift_cash_movements',
    'shift_movement_receipts', 'menu_availability_audit',
    'order_request_resolutions', 'order_request_hashes', 'device_order_links',
    'food_ingredients', 'food_recipes', 'recipe_cost_lines', 'manual_recipe_cost_lines',
    'sales_channels', 'channel_prices', 'modifier_groups', 'modifier_options',
    'discount_catalog', 'discount_catalog_audit', 'discounts',
    'print_policies', 'receipt_templates', 'receipt_template_versions',
    'receipt_assets', 'printer_devices', 'printer_routes', 'print_batches',
    'business_expenses', 'restaurant_setup', 'kds_stations', 'kds_product_routes',
    'kds_option_routes', 'kds_config_audit', 'approval_requests', 'shift_signoffs',
    'menu_archive_audit', 'product_price_option_groups', 'order_item_cost_snapshots'
  ];

  for (const table of tables) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all();
      if (!cols.length) continue;
      if (!cols.some(c => c.name === 'tenant_id')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN tenant_id TEXT`);
      }
      try {
        db.exec(`CREATE INDEX IF NOT EXISTS ${table}_tenant_id ON ${table}(tenant_id)`);
      } catch {}
    } catch (err) {
      console.warn(`Skipped ${table}: ${err.message}`);
    }
  }
}
