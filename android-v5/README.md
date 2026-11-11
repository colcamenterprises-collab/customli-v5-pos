# Customli universal Android application

One application (`io.customli.v5pos`, upgrade-compatible with the existing V5 package), launcher **Customli**, version **1.1.0 (10002)**. The authenticated device registry assigns POS, KDS or CDS. Deep links open the saved assignment and cannot override it.

## Build

Requires Node 22+, JDK 21, Android SDK 35 and the sibling `customli-v5/customli-v5-kds/public` source checkout. Point `CUSTOMLI_KDS_PUBLIC` at that directory when using a different layout.

```bash
npm ci
npm run build:android
npm run test:android-assets
node android-v5/universal-shell.e2e.mjs
cd android-v5
ANDROID_HOME=/opt/android-sdk ./gradlew assembleDebug bundleRelease
```

`preBuild` runs the asset packaging script. POS reuses the existing React implementation. KDS reuses the existing kitchen application. CDS is a restricted customer presentation. All application assets are bundled locally; the Capacitor config has no hosted `server.url`.

Release signing uses an independently managed keystore supplied by `CUSTOMLI_ANDROID_KEYSTORE`, `CUSTOMLI_ANDROID_STORE_PASSWORD`, `CUSTOMLI_ANDROID_KEY_ALIAS` and `CUSTOMLI_ANDROID_KEY_PASSWORD`. With no signing configuration, release artifacts remain unsigned and cannot be distributed as a production release. Debug signing is for isolated testing only.

## Device and security behavior

- Sign in with an existing account, choose an authorized restaurant and device assignment, then save. A sole restaurant and sole compatible POS are preselected.
- The device credential and saved assignment use AES-GCM encryption with an Android Keystore key. Account passwords are not stored. Device credentials use session memory in embedded operational views; Android backup and cleartext transport are disabled.
- Restart opens the saved assignment. Online authorization is checked first; a network failure permits cached operation only within the server's explicit `offlineUntil` lease. Online revocation immediately clears saved credentials and closes the operational view.
- Heartbeats apply Dashboard reassignment. KDS caches are scoped to credential and device/location; reassignment and revocation clear old kitchen caches.
- POS and KDS embedded views reuse the outer native HTTP/printing bridge. The POS server remains authoritative for transactions and receipt numbers. Electronic payment authorization is not inferred from offline connectivity.
- CDS uses the authorized display feed, suppresses stale payment/order presentations, and exposes no staff controls.
- Android NSD advertises opaque device IDs only. Discovered IDs are untrusted metadata intersected with the authorized same-location device registry. NSD does not authenticate peers or provide local order/print transport.

## Acceptance still required

Automated browser scenarios use a simulated native bridge and are **not** physical acceptance. Real Android restart/update, Keystore persistence, NSD behavior, Bluetooth discovery/pairing, printed paper (58/80 mm, Thai/modifiers), printer coexistence and any cash drawer require real-device testing. Production signing, Google Play track access and store promotion are external release gates. No physical-device, printer or Google Play publication readiness is asserted by this source change.
