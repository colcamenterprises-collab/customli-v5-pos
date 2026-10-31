# V5 Receipt Studio, labels and print queue

Implementation and evidence — 30 October 2026.

## Boundaries

V5 remains one restaurant/location per deployed database. The print location ID is generated once in that database and cannot be supplied or switched by clients. Device tokens only address their assigned printer. This is not a multi-tenant deployment claim. Existing POS orders, totals, discounts, refunds and KDS remain authoritative.

Receipt Studio uses versioned templates. Canonical order data, business identity, template version, batch, revision and packing units are captured in immutable print snapshots. Uploaded images are normalized once and referenced by immutable location asset IDs. Preview and ESC/POS, ZPL or TSPL encoding share the same raster, including the bundled OFL Noto Sans Thai font. Label overflow is rejected rather than cropped. Receipt output uses 384/576-dot raster defaults; physical media and DPI must be certified for the selected model.

Print Manager includes pairing/revocation, single gateway session ownership, route deduplication, a persistent queue, lease expiry, bounded retries of definite pre-write failures, uncertainty review, audit, explicit reprint and compatible backup selection. A successful socket write yields `sent` with paper output unverified; the queue can continue, and sent jobs are never automatically retried. Ambiguous interrupted writes and expired claims yield `uncertain` and block that printer until an operator checks the paper. Only observed paper or a certified completion protocol establishes confirmation.

Payment request quotes use current server prices, remain unpaid, and never create a financial order. POS settlement stays explicit. Marketing QR uses HTTPS URLs, channels and campaign windows; payment QR remains a separately uploaded static image. Provider payment and delivery adapters are verified-signature/replay/amount/reference contracts, not activated bank or delivery integrations.

## Packing

Configure meal rules before new sales. Meal components replace the parent as physical packing units. Quantities are either individually packaged or grouped per component. Selected modifier components retain option identity. Saved packing rules are copied into the KDS outbox; both labels and kitchen preparation read those saved components. Refunds increment packing revisions, skip unsent obsolete labels and make in-flight output uncertain. Configure `Order revised / refunded` routes to produce replacement/void labels. Historical unconfigured orders cannot establish meal contents that were never recorded.

KDS event publishing reads the existing KDS journal with a durable cursor and location/tenant selection. New installations begin at the current journal end, preventing historical print storms. It supports accepted, Expo packing started, all stations complete and Expo ready triggers. KDS audit identities are the existing device/operator labels; they are not invented employee sign-ins. Dashboard package verification records the authenticated manager/owner identity.

## Gateway

Run `gateway/print-gateway.mjs` on a local Linux gateway attached to the physical printer. Node 22+ is required. `discover` lists USB device paths and OS-paired RFCOMM devices; network addresses are entered from the printer network report. Bluetooth OS pairing and USB permissions are external prerequisites. No Android native shell is shipped or certified in this change.

Pair using `CUSTOMLI_PRINT_API` (full HTTPS API base), `CUSTOMLI_PAIR_CODE` and `CUSTOMLI_PRINTER_TARGET` (network host:port or /dev path), then run `node print-gateway.mjs pair` and `node print-gateway.mjs run`. Secrets are stored mode 0600 under `CUSTOMLI_PRINT_HOME` or the user's private configuration folder. Use a separate configuration directory per printer. The gateway maintains an OS connection-owner lock and durable per-job write journal. Do not run it on the remote VPS to reach a restaurant's private LAN.

For unattended gateway operation, install the included systemd unit with a dedicated service account and set its configuration directory. Discovery is local and does not scan arbitrary networks. Independent delivery tablets cannot be controlled by this gateway; use separate devices or ingest their orders into Customli.

## Deployment / rollback

Build and test candidate checkouts first. Back up both SQLite databases with the SQLite online backup API and verify `integrity_check`; do not copy a live WAL database file alone. Keep the prior application source and static builds. Never run QA transactions against production.

Use `V5_API_PREFIX=/v5-test/api` only on the test service. Optional `V5_PRINT_KDS_DB` and `V5_PRINT_KDS_TENANT` connect each POS deployment to its own KDS read-only journal. Restart only after a current active-shift check and a consistent backup. Verify order, line, refund and shift counts/sums after additive migrations. Rollback restores previous code/builds; new additive print tables can remain. Never restore an old financial database over newer sales.

## Competitive review and V3 reuse decision

Reviewed 30 October 2026 using official current documentation:

- Square [printer profiles](https://squareup.com/help/us/en/article/8245-set-up-printer-profiles): shared profiles and device assignments simplify setup; its documented multiple-profile/multiple-device duplicate risks motivate server-side print deduplication here.
- Toast [Expediter](https://support.toasttab.com/en/article/Setting-Up-an-Expediter): consolidated complete-order Expo tickets complement preparation stations. V5 keeps complete Expo content while filtering station tickets.
- Lightspeed [printing profiles](https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804607010-Managing-printing-profiles): ordered fallback printers and backup headers are useful. Customli only permits explicit backup after a definite failure; ambiguous output never silently fails over.
- V3 `docs/spec/PRINTER-AGENT.md`, `PRINTER-CONTRACT.md`, `packages/ui/native-print-worker.mjs`, `apps/printer/src/native-printer.mjs`, `native/printer-agent/src/ThermalPrinterPlugin.java`, and Dashboard `ReceiptPreview` were inspected. The immutable snapshot, paired-agent and claim-before-send design principles were retained. No V3 runtime, tenant, database or native code was copied. V3 ASCII substitution/truncation, separate decorative CSS preview and transport-success-as-printed behavior were rejected. The native plugin's deliberate post-write Bluetooth release does not establish exclusive ownership against third-party apps.

## Acceptance limits

No physical printers, Android tablets, label media, firmware tests, camera scans or drawer tests were available. No model is certified. Network/USB/Bluetooth connection and actual output, label gap/mark alignment, cutter/peeler behavior, QR readability, discovery and the five-minute setup target require a real gateway/device session. Labels do not invent allergens, handling dates or shelf life. Live payment and delivery activation requires the actual provider's credentials, documented signature protocol and approval.

Renderer references: Epson's [GS v 0 reference](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_lv_0.html) documents the raster header, one-bit polarity and model-specific limits; this is a legacy capability, not universal ESC/POS compatibility. Zebra's [programming guide](https://cpws.zebra.com/cpws/docs/zpl/zpl_manual.pdf) and TSC's [official manual downloads](https://apac.tscprinters.com/en/downloads) are the manufacturer references for the label adapter command families. Physical certification must establish the actual firmware's supported language/media settings.
