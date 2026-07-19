# kis-hts — macOS HTS 설계 문서

> KIS(한국투자증권) OpenAPI 기반 macOS 홈트레이딩시스템(HTS).
> 이 문서는 **살아있는 설계 문서**로, 구현이 진행되면서 계속 갱신한다.

- 최초 작성: 2026-07-16
- 상태: **P0 착수 (백엔드 골격)**
- 시각화 아키텍처 문서(옵션 비교): https://claude.ai/code/artifact/f0e1957a-eaf7-4ee9-afdb-4b06d175577e

---

## 1. 확정 스택

| 항목 | 결정 | 근거 |
|---|---|---|
| 아키텍처 | **옵션 C** — Tauri 웹UI + 로컬 sidecar 백엔드 | UI 품질 최상 + 백엔드 재사용 |
| 백엔드 | **Python FastAPI** | 이웃 repo `open-trading-api` 최대 재사용 |
| 프론트 | **React + TypeScript** | 생태계·자료·차트 레퍼런스 풍부 |
| 차트 | **lightweight-charts** (TradingView) | 캔들/실시간에 최적, 경량 |
| 패키징 | **Tauri sidecar** (PyInstaller 프리즈) | `.app` 하나로 백엔드까지 번들 |
| MVP 스코프 | **국내주식 · 단일계좌 · 모의투자** | 모의로 주문까지 검증 후 실전 전환 |
| 운영 | **HTS 단독** (auto-trading 병행 X) | 별도 앱키·Redis 불필요, 자체 KIS WS 1세션 |

### 운영 전제
HTS를 `auto-trading`과 **동시에 돌리지 않는다.** 따라서:
- KIS는 앱키/계좌당 WS 1세션만 허용하지만, 병행하지 않으므로 **기존 앱키/계좌로 HTS가 자체 WS를 자유롭게 연다.**
- 별도 앱키 발급, Redis 시세 공유 불필요 → 인프라가 단순해진다.

---

## 2. 검증된 KIS API 사용법 (소스: open-trading-api)

실제 코드를 읽어 확인한 사실. 재구현이 아니라 이 패턴을 재사용한다.

### 인증
- 접근토큰: `ka.auth(svr, product)` → `POST /oauth2/tokenP`
  `{grant_type:"client_credentials", appkey, appsecret}`
- 웹소켓 접속키: `ka.auth_ws()` → `POST /oauth2/Approval`
  `{grant_type, appkey, secretkey, token?}`
- 환경 취득: `trenv = ka.getTREnv()` → `my_app, my_sec, my_acct, my_prod, my_htsid, my_token, my_url, my_url_ws`
- **토큰 캐시:** `~/KIS/config/token_{acct}_{YYYYMMDD}.json`, 1일 유효, **재발급 1회/분 제한** → 반드시 캐시 재사용
- 설정 파일: `~/KIS/config/kis_devlp.yaml` (repo 루트의 템플릿을 복사)

### REST
- 모든 호출이 `ka._url_fetch(api_url, tr_id, tr_cont, params, postFlag, ...)`로 수렴 → `pandas.DataFrame` 반환
- 조회는 GET, **주문은 `postFlag=True`(POST)**
- **모의투자 TR_ID 자동 스왑:** `tr_id` 첫 글자 `T/J/C → V` (모의 활성 시 `_url_fetch`가 자동 처리)
- Rate limit: `EGW00201`(초당 초과) → 요청 간격 실전 ~70ms / 모의 ~1100ms 권장

### 주요 함수 (국내주식, `domestic_stock_functions.py`)
| 용도 | 함수 | TR_ID (실전/모의) |
|---|---|---|
| 현재가 시세 | `inquire_price` | FHKST01010100 |
| 호가/예상체결 | `inquire_asking_price_exp_ccn` | — |
| 일봉/분봉 차트 | `inquire_daily_itemchartprice` / `inquire_time_itemchartprice` | — |
| 현금 주문 | `order_cash` (ord_dv=buy/sell) | TTTC0012U/0011U → VTTC… |
| 정정/취소 | `order_rvsecncl` | TTTC0013U → VTTC0013U |
| 잔고 | `inquire_balance` | — |
| 매수가능 | `inquire_psbl_order` | — |
| 매도가능 | `inquire_psbl_sell` | — |
| 일별 체결 | `inquire_daily_ccld` | — |

### 실시간 (WebSocket)
- 엔진: `ka.KISWebSocket(api_url="/tryitout")`, 최대 40구독, 콜백은 `pandas.DataFrame`
- **주의: `kws.start()`는 `asyncio.run` 기반 블로킹 루프** → 반드시 별도 스레드에서 실행
- WS 빌더: `examples_user/domestic_stock/domestic_stock_functions_ws.py`

| 실시간 | TR_ID | 비고 |
|---|---|---|
| 체결가 | H0STCNT0 | `ccnl_krx` |
| 호가(10호가) | H0STASP0 | `asking_price_krx` |
| 체결통보 | H0STCNI0 (모의 H0STCNI9) | **HTS ID 기준 구독 + AES-256 복호화**(엔진 내장) |
| 예상체결 | — | `exp_ccnl_krx` |

---

## 3. 토큰 관리 패턴 (소스: auto-trading, 참고)

프로덕션 자동매매의 토큰 관리에서 차용할 원칙:
- **REST access token과 WS `approval_key`를 분리 관리** (별도 만료/갱신)
- **만료 10분 전 선제 갱신**, 재발급 rate limit(`EGW00133`) 회피
- 조회 우선순위: 메모리 → (Redis) → 파일 캐시 → API 발급

HTS 단독 운영이므로 **Redis 없이 메모리 + 파일 캐시(`~/KIS/config/`)** 2단계로 충분.

---

## 4. 시스템 아키텍처

```
┌──────────────── Tauri 앱 (macOS .app) ────────────────┐
│  Frontend (React + TS)                                 │
│  ├─ 관심종목 · 호가창(10호가) · 주문패널                 │
│  ├─ 차트: lightweight-charts                            │
│  └─ 잔고 · 체결내역 · 손익                               │
│            │  localhost  REST + WebSocket               │
│   ┌────────▼──────── Sidecar 백엔드 (FastAPI) ──────┐  │
│   │  ├─ REST 프록시: 시세/차트/잔고/주문              │  │
│   │  ├─ WS 릴레이: KIS WS → 로컬 WS 브로드캐스트       │  │
│   │  ├─ TokenManager: kis_auth 래핑 · 파일 캐시       │  │
│   │  ├─ Rate limiter                                 │  │
│   │  └─ SQLite: 관심종목 · 설정 · 주문 로그            │  │
│   └───────────────────┬────────────────────────────┘  │
└───────────────────────┼────────────────────────────────┘
                        │ HTTPS / WSS
                  KIS OpenAPI (실전 / 모의)
```

### 계층
- **L5 UI** (React): 관심종목, 호가창, 차트, 주문패널, 잔고/체결
- **L4 상태** (프론트): zustand 등 상태관리 + 백엔드 WS 구독 → 실시간 갱신
- **L3 도메인 서비스** (백엔드 라우터): QuoteService, OrderService, AccountService, RealtimeService
- **L2 KIS 연동** (백엔드): REST 클라이언트(`_url_fetch` 래핑 + rate limiter), KISWebSocket 엔진(별도 스레드)
- **L1 인증/토큰**: TokenManager (`ka.auth`/`ka.auth_ws` 래핑, 파일 캐시)
- **L0 설정**: `~/KIS/config/kis_devlp.yaml`, prod/vps 프로파일

### 프론트↔백엔드 계약 (로컬)
- REST: `http://127.0.0.1:{PORT}/api/...` (JSON)
- 실시간: `ws://127.0.0.1:{PORT}/ws` — 백엔드가 KIS WS 수신분을 정규화해 브로드캐스트
  - 메시지 예: `{type:"tick", symbol, price, ...}`, `{type:"orderbook", symbol, asks[], bids[]}`, `{type:"fill", ...}`

---

## 5. 리포지토리 구조

```
kis-hts/
├─ docs/
│  └─ DESIGN.md              # 이 문서 (살아있는 설계)
├─ backend/                  # FastAPI (Python, uv)
│  ├─ app/
│  │  ├─ main.py             # FastAPI 앱 + 로컬 WS 엔드포인트
│  │  ├─ config.py           # 설정 로드 (prod/vps, 포트)
│  │  ├─ kis/                # KIS 연동 계층 (open-trading-api 래핑)
│  │  │  ├─ auth.py          # TokenManager
│  │  │  ├─ rest.py          # REST 래퍼 + rate limiter
│  │  │  └─ ws.py            # KISWebSocket 관리 + 로컬 릴레이
│  │  ├─ realtime.py         # 로컬 WS broadcast 허브
│  │  ├─ store.py            # SQLite (관심종목·설정·로그)
│  │  └─ routers/
│  │     ├─ quotes.py        # 시세/차트
│  │     ├─ account.py       # 잔고/매수가능
│  │     └─ orders.py        # 주문/정정/취소
│  ├─ vendor/                # open-trading-api (git submodule 예정)
│  ├─ pyproject.toml
│  └─ README.md
├─ frontend/                 # Tauri + React + TS (P1에서 본격 착수)
└─ README.md
```

### 실행 방법 (개발)
```bash
# 1) 백엔드 (터미널 A)
cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8787
# 2) 프론트 (터미널 B)
cd frontend && npm run dev        # → http://localhost:1420
```
프론트는 `127.0.0.1:8787` REST + `ws://127.0.0.1:8787/ws`를 구독. 장중(09:00~15:30)에 호가/체결이 실시간 갱신됨. 프론트 프레임워크: React+TS(Vite), 상태 zustand, 차트 lightweight-charts(P2).

### 네이티브 앱 (Tauri, P4)
```bash
# 사전: Rust 설치됨(~/.cargo). 백엔드(:8787)는 별도로 먼저 실행.
cd frontend
npx tauri dev                    # 네이티브 창(개발, Vite 자동 실행)
npx tauri build --bundles app    # 릴리스 .app 생성 (DMG는 TCC 권한 이슈로 제외)
# 결과물: frontend/src-tauri/target/release/bundle/macos/kis-hts.app
```
현재 `.app`은 프론트만 번들 → **백엔드(:8787)를 먼저 실행해야** 데이터가 뜬다. 완전 자기완결(더블클릭만으로 구동)은 백엔드를 PyInstaller로 프리즈해 Tauri `externalBin`(sidecar)로 번들하는 잔여 작업 필요.

### open-trading-api 재사용 방식
- **계획:** `backend/vendor/open-trading-api`를 **git submodule**로 추가 (auto-trading도 동일 패턴 사용)
- 백엔드 기동 시 `sys.path`에 vendor 경로 및 `examples_user/domestic_stock` 추가 → `import kis_auth as ka`, WS 빌더 import
- 개발 중에는 이웃 repo `/Users/feelingsgap/work/git/open-trading-api`를 직접 참조 가능

---

## 6. MVP 단계 계획

| 단계 | 산출물 | 상태 |
|---|---|---|
| **P0** 백엔드 골격 | 프로젝트 구조 · TokenManager · config · `/health` · 로컬 WS 허브 뼈대 | ✅ 골격 완료·부팅 검증 |
| **P1** 실시간 시세 | 백엔드: 시세/호가/차트 REST + KIS WS 릴레이 ✅ / 프론트: React 관심종목·현재가·10호가창 + 로컬 WS 구독 ✅ | ✅ 완료 (Tauri 셸은 P4) |
| **P2** 차트 | 일/주/월봉 + 분봉 REST + lightweight-charts 캔들·거래량 렌더, 기간 토글 | ✅ 완료 |
| **P3** 주문/잔고 | 매수·매도(지정가/시장가)·취소 + 잔고·매수가능·미체결 + 주문/잔고 패널 UI · 호가단위 스냅 | ✅ 완료 (UI 실주문 검증) |
| **P4** 배포 | Tauri v2 네이티브 셸 + `.app` 빌드 ✅ / 백엔드 sidecar(PyInstaller)·코드서명은 잔여 | 🚧 셸·패키징 완료 |

---

## 7. 모의투자(vps) 자격증명 설정 — 확인된 사실

auto-trading의 `config/vps/.env`를 소스로 `~/KIS/config/kis_devlp.yaml`의 모의 필드를 설정.

| kis_devlp.yaml | 소스 (auto-trading vps/.env) | 상태 |
|---|---|---|
| `paper_app` | `KIS_APP_KEY` (메인 vps) | ✅ vps 토큰 발급 성공 |
| `paper_sec` | `KIS_APP_SECRET` | ✅ |
| `my_paper_stock` | **50197966** (사용자 확인) | ✅ 잔고조회 성공(예수금 1천만) |
| `my_htsid` | (기존 실전 HTS ID 사용) | P3 체결통보에서 재확인 |

- ⚠️ **주의:** `KIS_PAPER_APP_KEY`/`KIS_PAPER_APP_SECRET`는 vps 발급 실패(EGW00103 유효하지 않은 AppKey) → 사용 금지. 실제 동작하는 건 메인 `KIS_APP_KEY`/`KIS_APP_SECRET`.
- ✅ **계좌번호 해결:** 모의 계좌 = **50197966**(사용자 확인). `KIS_APP_KEY`와 매칭되어 `inquire_balance` 성공(예수금 1천만, 보유 0). 평문 `KIS_PAPER_STOCK`은 무효 앱키의 계좌라 `INVALID_CHECK_ACNO`였음(사용 안 함). `KIS_ACCT_NO`는 암호화라 미사용.
- 토큰 캐시는 **env 접미사(`_demo`)로 완전 격리**(`TokenManager._isolate_token_cache`) — 실전/모의 계좌번호가 같아도 토큰 안 섞임. vps가 실전 토큰 재사용해 EGW00123 나던 문제 해결.

## 8. 열린 이슈 / 결정 대기

- [x] **모의 계좌번호** = 50197966 (확인 완료) → P3 착수 가능
- [ ] `open-trading-api` submodule 원격 URL 확정 (현재 이웃 repo 직접 참조로 동작)
- [x] 백엔드↔프론트 로컬 포트 = **8787** 고정
- [ ] 프론트 상태관리 (zustand 유력) + Tauri sidecar 기동 방식
- [ ] SQLite 스키마 (관심종목, 설정, 주문 로그)
- [ ] WS 동적 구독(관심종목 실시간 변경) — 현재는 기동 시 고정, 재기동 필요

---

## 변경 이력
- 2026-07-16: 최초 작성. 스택 확정(옵션 C / FastAPI / React+TS / 국내·단일·모의).
- 2026-07-16: P0 백엔드 골격 완료 — 프로젝트 구조, `config.py`(open-trading-api 부트스트랩), `TokenManager`(kis_auth 지연 래핑), 로컬 WS 허브(`realtime.py`), FastAPI 앱(`/health`·`/api/auth/status`·`/ws`). `uv sync` + 부팅 스모크 검증 통과.
- 2026-07-16: P1 백엔드 완료·실데이터 검증 — vps 모의 자격증명 설정(§7), env별 토큰 캐시 격리, 시세/호가/차트 REST(`rest.py`·`routers/quotes.py`), KIS WS 릴레이(`ws.py`, 체결 H0STCNT0 + 호가 H0STASP0). 검증: `/api/quote/005930`=279,500원, 일봉 83개·주봉 17개, WS 6구독 전부 SUBSCRIBE SUCCESS. rate limiter vps 1.1s로 EGW00201 해소. 실시간 틱은 장 개시(09:00) 후 유입.
- 2026-07-16: P1 프론트 완료 — Vite+React+TS(`frontend/`). 관심종목/현재가/10호가창 컴포넌트, zustand 스토어, 로컬 REST+WS 클라이언트(자동 재연결). 트레이딩 터미널 다크 테마(상승 red/하락 blue). `npm run build` 타입체크 통과, dev 서버(:1420) 서빙 확인. Tauri 네이티브 셸은 Rust 설치 후 P4에서.
- 2026-07-16: P2 차트 완료 — 백엔드 분봉 엔드포인트(`/api/chart/{symbol}/minute`, `inquire_time_itemchartprice`) 추가. 프론트 `components/Chart.tsx`(lightweight-charts v5, 캔들+거래량 히스토그램, 1분/일/주/월 토글). 레이아웃: 현재가 헤더 아래 [차트 | 호가창]. 검증: 일봉 83·분봉 30(전일 실데이터), `npm run build` 통과. 분봉 시각축은 KST 벽시계를 UTC로 취급해 라벨 정합.
- 2026-07-16: 모의 계좌 확정 = **50197966**(사용자 확인, `KIS_APP_KEY`와 매칭). 토큰 캐시 격리를 env 접미사(`_demo`)로 강화.
- 2026-07-16: P3 주문/잔고 완료·UI 실주문 검증 — 백엔드 `rest.py`(balance/psbl_order/place_order/revise_cancel/pending_orders, 주문실패 stdout 캡처로 에러 surfacing) + `routers/account.py`·`orders.py`. 프론트 `OrderPanel`(매수/매도·지정가/시장가·호가클릭 연동)·`Balance`·`PendingOrders`, KRX 호가단위 스냅(`snapToTick`). 3열+하단 레이아웃. **브라우저 실주문 검증**: 지정가 매수 1주(즉시체결→보유·잔고갱신) → 시장가 매도(체결→잔고복구), 호가단위오류 메시지 표시 확인. 주의: 모의에서 `inquire_psbl_rvsecncl`은 빈값 → 미체결은 `inquire_daily_ccld(ccld_dvsn=02)`로 조회. 체결통보 실시간(H0STCNI9)은 미구현(잔고 5초 폴링으로 대체).
- 2026-07-17: **env 명칭 `demo/real` → `vps/prod` 통일** (KIS svr 규칙과 일치). `Settings.env`=vps(기본)|prod, `svr`(=env), 국내주식 함수용 `env_dv`(real/prod·demo/vps)는 매핑 프로퍼티(`Settings.env_dv`). config 디렉토리 `config/{demo,real}`→`config/{vps,prod}`. **토큰 파일 env 접미사(`_demo`) 제거** — 실전(43553464)/모의(50197966) 계좌번호가 달라 `token_{계좌}_{date}.json`로 자연 분리(사용자 요청). 검증: 기본 vps(env_dv=demo)·시세 OK, prod(env_dv=real)·실전계좌 로드 OK, 토큰 접미사 없이 생성.
- 2026-07-17: **폴더명 변경 `kis-trading` → `kis-hts`**. 경로 참조는 상대(`Path(__file__).parents[2]`)라 코드 무영향; README·DESIGN·주석만 갱신. venv/node_modules는 재배치 후 정상(uv/npm 상대해결). 토큰 캐시(~/KIS/config)·repo config/{demo,real}/.env 위치 불변.
- 2026-07-17: **자격증명 repo 내 관리로 전환**(auto-trading config/{prod,vps} 패턴). `config/{demo,real}/.env`(gitignore) + `config/.env.example`(커밋). `config.py:load_credentials(env)`가 `config/{env}/.env`(KIS_APP_KEY/SECRET/ACCT/HTS_ID/PROD)를 로드 → `auth.py:_apply_repo_credentials`가 kis_auth `_cfg`에 주입(yaml 값 오버라이드, repo 없으면 yaml 폴백). **토큰 파일 캐시는 ~/KIS/config/ 유지**(사용자 요청). 검증: `_cfg[paper_app/my_paper_stock/my_htsid]`==repo 값, 인증+시세 OK, `git add -A` 시 `.env.example`만 스테이징(자격증명 무시). 파일 퍼미션 600.
- 2026-07-17: 성능/버그 수정 — ① **봉 튀임**: `Chart.tsx` 실시간 틱 useEffect가 종목 가드 없이 새 종목 현재가를 옛 종목 캔들 마지막 봉에 써서 스파이크 발생 → `loadedRef`(로드된 종목/기간) 가드 추가 + 종목/기간 전환 시 `candlesRef` 초기화 + 지표토글(`panels`)을 fetch 의존성에서 제거해 재조회 없이 재렌더만(별도 effect). ② **로딩 지연**: rate limiter 1.1s가 과보수 → 모의 초당한도 실측(0.5s까지 6/6 성공) 후 **0.55s로 하향**(로딩 ~2배 단축, 6초 내 차트+지표 로드). 검증: 종목전환(삼성↔SK) 스파이크 없이 깔끔·빠름.
- 2026-07-19: **초기 로드 빈 패널(호가/현재가) 원인 규명·수정** — 원인은 프론트가 아니라 백엔드 rate limit. 0.55s(1.8/s) 간격에도 KIS 모의가 동시 버스트에서 EGW00201(초당 초과)을 간헐 반환(실측 동시 8건×3라운드: 0.55s **17%**·0.8s **8%** 실패)하고, open-trading-api가 빈 결과를 돌려주면 프론트 개별 `catch`가 이를 조용히 삼켜 해당 패널만 빈칸으로 남음. 위 07-17의 "0.55s 안전" 실측이 낙관적이었음. **간격 상향만으론 0% 불가** → `rest.py:_kis()` 래퍼 신설: limiter 직렬화 + 캡처한 stdout에서 EGW00201 감지 시 백오프(0.5→1.0→1.5s) 재시도. 조회 8함수(현재가/호가/일·분봉/잔고/매수가능/미체결/체결)에 적용, **주문(place_order/정정취소)은 상태 변경이라 제외**(`_limiter.wait()` 직접, 무분별 재시도 금지). 간격은 vps 0.8s로 상향. 검증: 동시 12건×4라운드(48건) **0% 실패**(KIS가 EGW00201 6회 반환했으나 재시도가 전량 흡수) + 브라우저 초기 로드 전 패널 정상. 프론트는 호가 시딩에 `alive` 가드 추가(종목 전환 중 도착한 옛 응답이 새 선택 덮어쓰기 방지).
- 2026-07-17: 보조지표 추가 — `indicators.ts`(SMA/EMA/볼린저/RSI(Wilder)/MACD, auto-trading `chart_indicators.py`와 동일 계산식 포팅). `Chart.tsx` 동적 다중패널: 캔들+MA5/20/60+**볼린저**(BB상/하 점선) 오버레이 / **거래량**·**RSI**(70·30 기준선)·**MACD**(라인+시그널+히스토그램) 서브패널. 헤더 토글칩(볼린저/거래량/RSI/MACD)으로 패널 동적 표시(그리드 높이 자동), 실시간 tick은 시리즈 merge로 zoom 유지. 검증: 4패널 전부 렌더 + **종목 변경 시 차트 전체 갱신·지표 재계산**(삼성→SK하이닉스) 정상. 미구현: 챈들리어(CE)·시그널/체결 마커(auto-trading 전용).
- 2026-07-17: ECharts 차트 보강 — ① 캔들 개수 확대: 백엔드 기본 기간을 주기별로(일 220일/주 1200일/월 4600일) 넓혀 KIS API 최대 100봉을 채움(기존 120일 고정 → 주봉 17·월봉 4개뿐이라 MA20/60 안 나오던 문제 해결). ② dataZoom 기본 start:0(전체) → 이평선 전체 가시화. ③ MA 레전드 좌상단(left). ④ 100봉 균등 배치로 캔들 간격 일정. 검증: 일/주 모두 100봉·MA5/20/60(주황 MA60 포함) 뚜렷.
- 2026-07-17: **차트 라이브러리 lightweight-charts → ECharts 전환** (auto-trading과 동일 라이브러리). `echarts` 6.1.0 트리셰이킹 import(core+CandlestickChart/LineChart/BarChart+Grid/Tooltip/Legend/DataZoom/AxisPointer+CanvasRenderer). `Chart.tsx`를 React 컴포넌트(echarts.init + ref/useEffect + ResizeObserver)로 재작성 — auto-trading `_chart_dialog.html` 옵션 참고(캔들 O-C-L-H, 상승 red/하락 blue, MA5 노랑/MA20 보라/MA60 주황, 거래량 서브그리드, cross 툴팁, dataZoom, 레전드 토글). 기간토글·실시간 봉갱신(setOption merge로 zoom 유지) 유지. 아키텍처 차이: auto-trading은 서버렌더(Jinja+HTMX)·CDN, kis-trading은 React SPA·npm 컴포넌트. 검증: 캔들·MA·거래량·레전드·dataZoom·기간토글(일→주) 정상. 번들 389→803KB(ECharts가 큼, 로컬앱 무방; 필요시 code-split). 참고: MA는 이동평균 계산 프론트(JS), auto-trading은 서버(chart_indicators.py).
- 2026-07-16: 관심종목 삭제 검증 + **순서변경(드래그) 신규 구현** — 삭제(× → `DELETE /api/watchlist/{sym}` + SQLite): UI·백엔드 영속 확인. 순서변경: `store.reorder`(SQLite pos 재부여) + `POST /api/watchlist/reorder` + 프론트 HTML5 드래그앤드롭(`Watchlist.tsx` draggable/onDragOver/onDrop, `.wl-row.over/.dragging` 스타일, `store.reorderWatchlist` 낙관적 갱신+영속). 검증: 드래그→UI 재정렬+백엔드 pos 영속. 주의: 브라우저 자동화 합성 드래그는 HTML5 DnD 이벤트 미발생(실제 사용자 드래그는 정상, DragEvent 디스패치로 확인). 초기 로드는 rate limit(1.1s/건) 순차라 수 초 소요(UX 개선 여지).
- 2026-07-16: 확장 기능 cat 1~4 (병행 fork: 백엔드/프론트 분리) — **백엔드**(`analysis.py`·`symbols.py`·`store.py` 신규, `rest.py`·`ws.py`·routers 확장): 체결내역(`/api/orders/filled`)·실현손익(모의 미지원→체결 근사)·예상체결(orderbook exp_*)·체결통보 WS(H0STCNI9)·동적 재구독·종목마스터(.mst 다운로드 캐시)+검색(`/api/search`)·관심종목 CRUD+SQLite(`/api/watchlist` POST/DELETE)·순위(`/api/ranking/*`)·투자자(`/api/investor`). **프론트**(신규 Toast·AccountPanel·OrdersPanel·Ranking·Investor·FilledOrders): 정정주문 UI·체결내역 탭·실현손익·예상체결 strip·체결통보 토스트·실시간 봉갱신·종목검색+관심종목 편집·MA5/20/60 오버레이·순위/투자자 탭. 브라우저 통합 검증 완료(검색→현대차 추가→전체 전환, 순위·투자자·체결내역 실데이터). 주: 프론트를 처음 fork로 돌렸을 때 역할 혼동으로 미구현 → fresh 일반 에이전트로 재구현. 실시간 봉/체결통보 토스트는 장중에만 관찰 가능. **미구현(보류)**: 재무·뉴스·공시·조건검색(cat4 일부).
- 2026-07-16: P4 Tauri 셸·패키징 — Rust 1.97 설치, `frontend/src-tauri/`에 Tauri v2 스캐폴드(식별자 `com.kis.hts`, 창 1440×900). `npx tauri dev` 네이티브 창 정상, `npx tauri build --bundles app` → **`kis-hts.app`(9.6M) 생성**. **검증**: 패키징 앱 실행 시 WebKit 네트워킹이 백엔드 :8787에 REST+WS 연결(ESTABLISHED 확인) → 실데이터 동작. `--bundles app`만 쓴 이유: DMG 생성이 AppleScript로 macOS TCC 권한 프롬프트에 걸림. 코드서명 안 함(로컬 실행은 quarantine 없어 바로 실행). **잔여**: 백엔드 sidecar(PyInstaller 프리즈 + `externalBin`)로 자기완결 패키징, 배포용 서명·공증.
- 2026-07-19: 기능 확장 Tier 1~3 (커밋 9312cd0~e4a07fa). **Tier1 안전·주문 UX**: 발주/취소 확인 다이얼로그(`OrderConfirm.tsx`, 오발주 방지), 매도 가능수량(잔고 orderable_qty)·전량·수량 프리셋, 부분취소·정정 시 지정가/시장가 선택(백엔드는 이미 `qty_all`·`ord_dvsn` 지원 — 프론트만 노출). **Tier2 편의**: UI 설정 localStorage 영속(`persist.ts` usePersisted — 차트 기간/지표토글/탭/선택종목/주문구분), 키보드 단축키(↑/↓ 종목·B/S 매수매도, `e.code` IME 무관), 가격 알림(`QuoteHeader` 🔔, WS tick 도달→토스트 후 자동해제, 종목별 영속). **Tier3 정보**: 상단 코스피/코스닥 지수 티커(`MarketBar`, `market_index`/inquire_index_price 단일 TR·env_dv 없음, `/api/index` 10초 폴링), 다분봉 3/5/10/30/60분(KIS 주식분봉은 1분만 제공→`_fetch_1min` 페이지네이션+`_aggregate_minutes` 서버 집계, `/chart/*/minute?interval=`), 종목정보 패널(재무비율·투자의견·뉴스, `stock_financials`/`stock_opinions`/`stock_news`, `/api/stock-info/{symbol}`, 세 API 모두 모의 지원 probe 확인). **버그 수정**: zustand v5 셀렉터가 새 배열 반환 시 무한 렌더 크래시 → 안정 참조만 셀렉트하고 필터는 렌더 본문에서(QuoteHeader). 각 기능 브라우저 검증. 주의: 실주문 제출·취소 end-to-end는 미수행(모의라도 주문 실행 대행 안 함) → 사용자 확인 필요.
