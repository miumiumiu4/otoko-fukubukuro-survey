#!/usr/bin/env bash
# GAS を clasp で作成・反映・デプロイし、config.js の API_URL を書き換える。
# 前提: `clasp login` 済み（~/.clasprc.json がある）。
# 2回目以降は同じデプロイIDを更新するので、公開URLは変わらない。
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .clasp.json ]; then
  clasp create-script --type standalone --title "漢の福袋 アンケート API" --rootDir gas
  # clasp が gas/appsscript.json を上書きすることがあるので、リポジトリの版に戻す
  git checkout -- gas/appsscript.json 2>/dev/null || true
fi

clasp push --force

DEPLOY_ID_FILE=.deployment-id
if [ -s "$DEPLOY_ID_FILE" ]; then
  DEPLOY_ID=$(cat "$DEPLOY_ID_FILE")
  clasp create-deployment --deploymentId "$DEPLOY_ID" --description "update $(date +%F_%T)"
else
  OUT=$(clasp create-deployment --description "initial")
  echo "$OUT"
  DEPLOY_ID=$(echo "$OUT" | grep -oE 'AKfy[A-Za-z0-9_-]+' | head -1)
  [ -n "$DEPLOY_ID" ] || { echo "デプロイIDを取得できませんでした" >&2; exit 1; }
  echo "$DEPLOY_ID" > "$DEPLOY_ID_FILE"
fi

URL="https://script.google.com/macros/s/${DEPLOY_ID}/exec"
sed -i.bak -E "s#API_URL: '[^']*'#API_URL: '${URL}'#" config.js && rm -f config.js.bak
echo "API_URL = $URL"
echo "スクリプトエディタ: https://script.google.com/home/projects/$(node -e 'console.log(require("./.clasp.json").scriptId)')/edit"
