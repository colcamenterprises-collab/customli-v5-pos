# Remaining tenant_id insert fixes

The following positional inserts must be updated to explicit column lists that include `tenant_id`:

- `print-model.mjs`: `enqueuePrint` → `INSERT INTO print_batches VALUES(...)`  
  **Patched on TEST and production runtimes** (explicit columns + tenant_id). Both services active.
- `print-service.mjs`: multiple `print_batches` and `receipt_template_versions` inserts
- `print-payments.mjs`: `print_batches` insert
- `onboarding.mjs`: `receipt_template_versions` insert

Pattern applied:
```js
const tenantId = process.env.PLATFORM_TENANT_ID;
db.prepare(`INSERT INTO print_batches(id,location_id,order_id,revision,event_key,created_at,tenant_id) VALUES(?,?,?,?,?,?,?)`)
  .run(batchId, loc, order.id, packing.revision, key, now(), tenantId);
```

Code changes for the remaining files will continue on this branch.
