# kis-hts

KIS(한국투자증권) OpenAPI 기반 **macOS HTS**(홈트레이딩시스템).

- 아키텍처: Tauri 네이티브 셸(React+TS) + 로컬 sidecar 백엔드(FastAPI)
- 국내주식 · 단일계좌 · **모의/실전** (기본 모의)
- 상세 설계·변경이력: [`docs/DESIGN.md`](docs/DESIGN.md) — 살아있는 설계 문서

## 구조
```
kis-hts/
├─ config/          # KIS 자격증명 (vps/.env 모의 · prod/.env 실전, gitignore) + .env.example
├─ backend/         # FastAPI 로컬 백엔드 (시세/호가/차트/주문/잔고 REST + WS 릴레이)
├─ frontend/        # Vite + React + TS (+ src-tauri: Tauri 네이티브 셸)
└─ docs/DESIGN.md   # 설계 문서
```

## 자격증명 설정
`config/.env.example`를 참고해 `config/vps/.env`(모의)·`config/prod/.env`(실전) 작성:
```
KIS_APP_KEY=... / KIS_APP_SECRET=... / KIS_ACCT=계좌8자리 / KIS_HTS_ID=... / KIS_PROD=01
```
토큰 파일 캐시는 `~/KIS/config/`에 저장됨.

## 실행 (개발)
```bash
# 터미널 A — 백엔드 (기본 vps=모의)
cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8787
#   실전: KIS_HTS_ENV=prod 를 앞에 붙임 (실주문 주의!)
# 터미널 B — 프론트
cd frontend && npm run dev        # → http://localhost:1420
# 네이티브 앱: cd frontend && npx tauri dev  (Rust 필요)
```

## 기능
실시간 호가(10단계)·체결·차트(ECharts: 캔들+MA+볼린저+RSI+MACD, 일/주/월/분) · 관심종목(검색·추가/삭제·드래그 순서변경) · 주문(매수/매도·지정가/시장가·정정/취소) · 잔고/손익 · 미체결/체결내역 · 순위 · 투자자매매동향 · 체결통보 실시간. 실시간은 장중(09:00~15:30) 유입.
