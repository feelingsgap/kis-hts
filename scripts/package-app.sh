#!/usr/bin/env bash
# kis-hts 패키징 — 백엔드를 동결(PyInstaller)해 Tauri .app 안에 sidecar로 동봉한다.
#
# 결과: frontend/src-tauri/target/release/bundle/macos/kis-hts.app
#   (더블클릭 → 셸이 번들된 백엔드를 자동 기동/종료. 모의투자 기본.)
#
# 전제(이 맥):
#   - open-trading-api  = ~/work/git/open-trading-api  (런타임 참조)
#   - 자격증명          = config/{vps,prod}/.env       (번들에 넣지 않음)
#   - KIS 정적설정/토큰 = ~/KIS/config/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "▶ 1/3  백엔드 동결 (PyInstaller onedir)…"
cd "$ROOT/backend"
rm -rf packaging/build packaging/dist
uv run pyinstaller packaging/kis-hts-backend.spec --noconfirm \
    --distpath packaging/dist --workpath packaging/build

echo "▶ 2/3  sidecar 리소스 동기화…"
DEST="$ROOT/frontend/src-tauri/resources/backend"
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
cp -R "$ROOT/backend/packaging/dist/kis-hts-backend" "$DEST"
touch "$DEST/.gitkeep"

echo "▶ 3/3  Tauri .app 번들…"
cd "$ROOT/frontend"
npx tauri build --bundles app

echo "✓ 완료 → frontend/src-tauri/target/release/bundle/macos/kis-hts.app"
