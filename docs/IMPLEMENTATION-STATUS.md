# Universal Customli Android implementation

Checkpoint: 2026-11-08. Baseline POS main d9dbc6b46caca82304d9d87281441db6970a54b7; Dashboard/KDS main 91c0d4d75f3ef6b3ef21421dd5b048edccb4a0c4.

| Work package | Status | Evidence / next action |
| --- | --- | --- |
| Repository and runtime audit | IN PROGRESS | Both sources inspected; live services and data paths identified. Live POS checkout has historical uncommitted deployment changes, so release from isolated clean clones. Full audit cannot be called complete yet. |
| Central device registry | DONE | Additive identity DB tables; explicit locations, manager registration, persistent roles, revocation, heartbeat, same-location peer metadata. device-registry.test.mjs passes. |
| POS tenant/location and mode isolation | DONE | Required tenant binding fails closed; native devices require exact configured location. CDS denied staff and financial routes. universal-api.test.mjs passes. |
| CDS API and display | IN PROGRESS | Server-authoritative prices, safe customer fields, linked POS completion, monotonic snapshots. App rendering/build verification pending. |
| Order synchronization | IN PROGRESS | IndexedDB command persistence before submit, payload mismatch rejection, original idempotency key recovery, 30-order HTTP acceptance passes. Native offline restart test pending. |
| Universal Android | IN PROGRESS | Existing package retained; local POS/KDS assets, Keystore device credential, server-assigned mode. Build/release testing pending. |
| KDS | DONE (software integration) | Scoped central identity, durable operation deduplication, amendment/cancellation revision handling. Isolated universal-kds test passes. Physical/offline transport acceptance pending. |
| Dashboard device management | IN PROGRESS | New Devices page with role/location updates and revocation. Build/browser verification pending. |
| Printing | IN PROGRESS | Existing native Classic Bluetooth and central Receipt Studio reused. Hardware and shared native queue integration pending. |
| LAN operation | NOT STARTED | Discovery metadata alone does not provide authenticated operational LAN transport. |
| Signed Android / Play | BLOCKED | Signing/distribution access and physical hardware acceptance required; see blockers. |
| Merge and deployment | NOT STARTED | Exact-commit release gate required. Existing production data must be backed up and verified. |

Runtime: POS `/opt/apps/customli-v5-pos`, data `/var/lib/customli-v5/pos.sqlite`; test `/opt/apps/customli-v5-test`, data `/var/lib/customli-v5-test/pos.sqlite`. Auth `/opt/apps/customli-v5-auth`, data `/var/lib/customli-v5-auth/identity.sqlite`. KDS `/opt/apps/customli-v5-kds`, data `/var/lib/customli-v5-kds/kds.sqlite`. Dashboard `/opt/apps/customli-v5-dashboard`.

Production tenant: `6f63e200-a5e8-4cdd-b33e-27b2f17f4e20`. Existing KDS namespace `customli-v5-prod` must be explicitly mapped; do not rewrite historical KDS tenant IDs.

Working checkouts on VPS: `/opt/work/universal-v5/pos` branch `feat/universal-android`; `/opt/work/universal-v5/dashboard` branch `feat/universal-devices`. Do not deploy from historical dirty live checkout.

Owner confirmed on 2026-11-08 that all V5 operational records are test data and authorized closure of the open test shift. Preserve records and back them up regardless.

Next action: finish app and printer batch, transfer all changed sources to clean VPS clones, commit, run exact release gate, review screenshots, publish checks, merge, rerun gate on merged head, deploy test then production with backup and rollback. Keep operational browser routes until physical native acceptance.
