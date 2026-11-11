# Universal application blockers and incomplete acceptance

| ID | Status | Dependency / next action |
| --- | --- | --- |
| EXT-01 | BLOCKED | No physical Android tablet or printer is attached to the VPS (`adb devices` returned empty). Owner must install testing build and execute pairing, Thai receipt, 58/80 mm, disconnect/restart/update and multi-tablet acceptance. |
| EXT-02 | BLOCKED | Production Android signing keystore and authorized Play Console testing-track access not yet established. Do not create a new production signing identity without checking existing Play app certificate. |
| REL-01 | DONE | Owner-authorized test shift closed after backup; 33 orders and one refund preserved, counted/expected cash zero. |
| ENG-01 | NOT STARTED | Authenticated local operational transport during internet outages, LAN print sharing and peer failure handling still need implementation and real network acceptance. NSD metadata is not proof of authenticity or working local sync. |
| ENG-02 | IN PROGRESS | Offline cash command durability does not by itself satisfy complete restaurant offline operation. App termination, reboot, lease expiry, multiple terminals and backend recovery need evidence. Electronic payment initiation requires online authorization; server-recorded manual QR is not bank authorization. |
| ENG-03 | IN PROGRESS | Native printing reliability and setup changes need automated tests; physical print readiness remains unverified. Network printer discovery and backup/shared routing must not be marked complete from existing gateway code alone. |
| ENG-04 | IN PROGRESS | KDS now accepts amendments/cancellations; POS outbox must publish applicable changed/refunded snapshots. Existing refund semantics must not silently cancel already-prepared food. |
| REL-02 | NOT STARTED | Retire browser operational routes only after native replacements pass acceptance. |

Do not report overall mission complete while any mandatory acceptance item remains unverified.
