# Implementation decisions

- Keep package `io.customli.v5pos` to preserve installed-app update compatibility; launcher becomes Customli. Verify existing Play identity before production signing.
- Reuse the POS build and KDS source as local assets. No second financial implementation and no hosted operational URL in the native container.
- Dashboard identity remains authoritative. Device tokens are separately hashed credentials, scoped to one configured location and assigned mode; never trust local network discovery as authentication.
- One operational SQLite deployment currently serves one explicit tenant/location. Fail closed when central auth lacks the tenant binding. Provision separate operational deployments before exposing additional locations; do not claim the legacy unscoped schema is shared-database multitenancy.
- Keep historical KDS namespace via explicit configured mapping.
- Offline device authorization is limited to a server-issued 12-hour lease in encrypted native storage. Online revocation takes immediate effect; offline revocation can only take effect after reconnect or lease expiration.
- Persist payment command before sending; recover with the same key. Never automatically recreate a payment with a new key. Changed payloads with a used key are rejected.
- Customer display only receives public order fields. A recorded payment is described as recorded, never bank-confirmed. Cashier/manager controls are absent from CDS.
- KDS action operation IDs are durable and checked before quantity mutations; higher order revisions preserve matching completed production quantities while resetting packing checks.
- Print socket write success proves bytes sent only. Interrupted writes require inspection and explicit reprinting; blind retries can duplicate paper.
- Preserve existing browser routes until signed native physical acceptance passes.

- Registered device identities operate as separate cashier-level actors. Registering with an Owner account never leaves a permanent Owner credential on a staff tablet. Management remains account-authenticated in Dashboard; existing manager PIN approval remains required for sensitive POS actions.
- Recovery of an older queued payment must never clear a newly edited cart. Background recovery acknowledges the saved key and reports its receipt independently.

- Saved command cancellation requires manager PIN and a reason. The server first checks for a committed receipt, otherwise atomically records a tombstone; the tablet retains the resolved intent audit. Ambiguous or rejected commands are never silently removed. No manager PIN is persisted in IndexedDB.
- A queued request is bound to its original shift and displayed total. A closed shift or price change requires review; recovery cannot silently book into a later shift.
