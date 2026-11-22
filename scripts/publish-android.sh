#!/usr/bin/env bash
set -euo pipefail
# Usage: publish-android.sh /absolute/path/to/signed.apk VERSION
[[ $# == 2 ]] || { echo 'Usage: publish-android.sh SIGNED_APK VERSION' >&2; exit 2; }
src=$1; version=$2
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid version' >&2; exit 2; }
[[ -f "$src" ]] || { echo 'APK missing' >&2; exit 2; }
base=/opt/downloads/customli-v5
name="Customli-V5-Universal-${version}.apk"
# Check APK signature and manifest before updating the public pointer.
/opt/android-sdk/build-tools/35.0.0/apksigner verify "$src" >/dev/null
manifest=$(/opt/android-sdk/build-tools/35.0.0/aapt dump badging "$src" | sed -n "1p")
[[ "$manifest" == *"versionName='$version'"* ]] || { echo 'APK version mismatch' >&2; exit 1; }
[[ -s "$base/Customli-V5-Universal-1.2.4.apk" ]] || exit 1
reference=$(/opt/android-sdk/build-tools/35.0.0/apksigner verify --print-certs "$base/Customli-V5-Universal-1.2.4.apk" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | sed -n "1p")
current=$(/opt/android-sdk/build-tools/35.0.0/apksigner verify --print-certs "$src" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | sed -n "1p")
[[ -n "$reference" && "$reference" == "$current" ]] || { echo 'Production signing certificate mismatch' >&2; exit 1; }
if [[ "$src" != "$base/$name" ]]; then install -m 0644 "$src" "$base/$name"; fi
ln -sfn "$name" "$base/.latest-next.apk"
mv -Tf "$base/.latest-next.apk" "$base/Customli-V5-Universal-Latest.apk"
python3 - "$base" "$version" "$name" <<'PY'
import sys,json,hashlib,datetime,os
base,version,name=sys.argv[1:]
path=os.path.join(base,name)
data={'version':version,'publishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'downloadUrl':'/downloads/customli-v5/Customli-V5-Universal-Latest.apk','filename':name,'sizeBytes':os.path.getsize(path),'sha256':hashlib.sha256(open(path,'rb').read()).hexdigest()}
tmp=os.path.join(base,'.latest-release.json.tmp')
with open(tmp,'w') as f:json.dump(data,f)
os.replace(tmp,os.path.join(base,'latest-release.json'))
PY
echo "Published $name as latest release"
