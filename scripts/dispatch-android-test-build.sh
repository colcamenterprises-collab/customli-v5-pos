#!/usr/bin/env bash
set -euo pipefail

readonly POS_REPO="colcamenterprises-collab/customli-v5-pos"
readonly APP_REPO="colcamenterprises-collab/customli-v5"
readonly STATE_FILE="/var/lib/customli-v5-android-dispatch/last-pos-sha"
readonly LOCK_FILE="/run/lock/customli-v5-android-dispatch.lock"

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

sha="$(gh api "repos/$POS_REPO/commits/main" --jq .sha)"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || { echo "RELEASE_HELD invalid_main_sha"; exit 1; }

if [[ -f "$STATE_FILE" ]] && [[ "$(cat "$STATE_FILE")" == "$sha" ]]; then
  exit 0
fi

passed="$(gh api "repos/$POS_REPO/actions/workflows/pos-release-gate.yml/runs?branch=main&per_page=25" |
  jq --arg sha "$sha" '[.workflow_runs[] |
    select(.head_sha == $sha and .event == "push" and .status == "completed" and .conclusion == "success")] | length')"

if [[ "$passed" -lt 1 ]]; then
  echo "RELEASE_HELD $sha waiting_for=POS_release_gate"
  exit 0
fi

gh workflow run android-build-gate.yml --repo "$APP_REPO" --ref main -f pos_commit="$sha"
mkdir -p "$(dirname "$STATE_FILE")"
tmp="$STATE_FILE.tmp"
printf '%s\n' "$sha" > "$tmp"
mv "$tmp" "$STATE_FILE"
echo "ANDROID_TEST_BUILD_DISPATCHED $sha"
