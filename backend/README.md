# kis-hts-backend

KIS OpenAPI macOS HTS의 로컬 sidecar 백엔드 (FastAPI). 조회/주문은 REST, 실시간(체결·호가·체결통보)은 WebSocket으로 프론트에 릴레이하는 하이브리드 구조. 상세 설계는 [`../docs/DESIGN.md`](../docs/DESIGN.md).

## 사전 준비
1. 이웃 repo `open-trading-api` 확보 (개발 중 자동 참조, 없으면 `OPEN_TRADING_API_PATH`로 지정 또는 `vendor/` 서브모듈).
2. 자격증명 작성 — `../config/.env.example` 참고해 `../config/vps/.env`(모의)·`../config/prod/.env`(실전):
   ```
   KIS_APP_KEY=... / KIS_APP_SECRET=... / KIS_ACCT=계좌8자리 / KIS_HTS_ID=... / KIS_PROD=01
   ```
   → `config.py:load_credentials`가 로드해 `kis_auth._cfg`에 주입(정적 URL/에이전트는 `~/KIS/config/kis_devlp.yaml` 사용). 토큰 파일 캐시는 `~/KIS/config/`에 계좌별로 저장.

## 실행 (개발)
```bash
uv sync                                              # 최초 1회
uv run uvicorn app.main:app --host 127.0.0.1 --port 8787 --reload   # 기본 vps(모의)
KIS_HTS_ENV=prod uv run uvicorn app.main:app --port 8787            # 실전 (실주문 주의!)
```

## 환경변수
| 변수 | 기본값 | 설명 |
|---|---|---|
| `KIS_HTS_ENV` | `vps` | `vps`(모의) / `prod`(실전). 미지정/오타는 안전하게 vps |
| `KIS_HTS_PRODUCT` | `01` | 계좌 상품코드 2자리 |
| `KIS_HTS_PORT` | `8787` | 로컬 서버 포트 |
| `OPEN_TRADING_API_PATH` | (자동탐색) | open-trading-api 경로 오버라이드 |

> KIS는 `svr`(prod/vps)와 `env_dv`(real/demo) 두 표기를 씀 → `env`(=svr)를 prod/vps로 두고 국내주식 함수용 `env_dv`는 매핑 프로퍼티로 변환. rate limiter는 vps 0.55s / prod 0.07s (실측 기반).

## 주요 엔드포인트
| 메서드·경로 | 설명 |
|---|---|
| `GET /health`, `GET /api/auth/status` | 상태·인증 |
| `GET /api/quote/{symbol}` | 현재가 |
| `GET /api/orderbook/{symbol}` | 10호가 + 예상체결 |
| `GET /api/chart/{symbol}/daily?period=D\|W\|M` · `/minute` | 차트(최대 100봉) |
| `GET /api/balance` | 잔고·보유·실현손익 |
| `GET /api/psbl-order/{symbol}` | 매수가능 |
| `POST /api/order` · `/order/cancel` · `/order/revise` | 매수/매도 · 취소 · 정정 |
| `GET /api/orders/pending` · `/orders/filled` | 미체결 · 체결내역 |
| `GET /api/search?q=` | 종목 검색(마스터) |
| `GET/POST /api/watchlist` · `DELETE /watchlist/{symbol}` · `POST /watchlist/reorder` | 관심종목 CRUD·정렬 (SQLite) |
| `GET /api/ranking/volume` · `/ranking/fluctuation?type=up\|down` | 순위 |
| `GET /api/investor/{symbol}` | 외국인/기관/개인 순매수 |
| `WS /ws` | 실시간 브로드캐스트 `{type: tick\|orderbook\|fill}` (장중) |

## 구조 (`app/`)
```
main.py             FastAPI 앱 · 라우터 등록 · /ws
config.py           설정(env) · 자격증명 로드 · open-trading-api 부트스트랩
store.py            SQLite (관심종목)
realtime.py         로컬 WS 브로드캐스트 허브
kis/auth.py         TokenManager (kis_auth 래핑 · 토큰 캐시 격리)
kis/rest.py         REST 시세/주문 래퍼 + rate limiter
kis/ws.py           KIS WS 매니저(체결 H0STCNT0 · 호가 H0STASP0 · 체결통보 H0STCNI0/9) · 동적 재구독
kis/symbols.py      종목 마스터 · 검색
kis/analysis.py     순위 · 투자자
routers/            quotes · account · orders · symbols · analysis
```
