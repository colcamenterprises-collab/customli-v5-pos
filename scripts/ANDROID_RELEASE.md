# Android production publication

The Dashboard Android download button always points at `/downloads/customli-v5/Customli-V5-Universal-Latest.apk`. The current version/date are obtained from `/downloads/customli-v5/latest-release.json` and are refreshed when the page opens and every 30 seconds.

After building and passing release tests, publish a production-signed APK with:

`sudo /opt/apps/customli-v5-release/publish-android.sh /absolute/path/to/app-release.apk X.Y.Z`

The publisher requires a clean merged-main checkout with a passing exact-source release-gate attestation; it rejects missing APKs, invalid signatures, incorrect embedded version names and APKs signed with a certificate other than the established production certificate. Published versioned APKs are immutable: attempting to publish different bytes under an existing version is rejected. Only after validation does it atomically move the latest pointer and manifest. Keep versioned APKs for rollback. Do not publish test/debug artifacts. Do not publish until CI release checks and physical acceptance for the intended release have passed.

The release script is also tracked in this repository at `scripts/publish-android.sh`; keep the deployed copy in sync. Do not manually edit Dashboard APK links for each version.
