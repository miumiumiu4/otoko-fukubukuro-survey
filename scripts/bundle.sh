#!/usr/bin/env bash
# gas/ の .gs を1ファイルにまとめる（スマホのGASエディタに1回で貼り付けるため）
set -euo pipefail
cd "$(dirname "$0")/.."
{
  echo "// 漢の福袋 アンケート API（gas/ の全ファイルを結合したもの。編集は gas/ 側で行い scripts/bundle.sh で再生成）"
  for f in Db Api Ai Mail Setup; do echo; echo "// ===== $f.gs ====="; cat "gas/$f.gs"; done
} > dist/Code.gs
echo "dist/Code.gs: $(wc -l < dist/Code.gs) lines"
