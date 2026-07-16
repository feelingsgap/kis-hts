# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

kis-hts는 KIS(한국투자증권) OpenAPI 기반 macOS HTS(홈트레이딩시스템)다. 두 프로세스로 동작한다: **로컬 FastAPI sidecar 백엔드**(`:8787`)와 **React SPA**(`:1420`), 선택적으로 **Tauri** 네이티브 셸로 감싼다. 하위 프로젝트 상세: `backend/CLAUDE.md`, `frontend/CLAUDE.md`.

## 큰 그림 아키텍처
- **하이브리드 데이터 흐름**: 조회/주문은 REST, 실시간은 로컬 WebSocket `/ws` 한 개. 백엔드가 *자체* KIS WebSocket을 열어 정규화한 `{tick, orderbook, fill}`을 프론트로 릴레이한다. 프론트는 KIS와 직접 통신하지 않고 로컬 백엔드하고만 통신한다(보안 경계 — 자격증명/토큰은 백엔드에만 존재).
- 백엔드는 **이웃 repo `open-trading-api`를 래핑**한다(`~/work/git/open-trading-api`, 또는 `OPEN_TRADING_API_PATH`) — 그 안의 `kis_auth.py`, `domestic_stock_functions.py`, WS 빌더를 쓴다. vendor로 넣지 않고 `backend/app/config.py:bootstrap_open_trading_api`가 런타임에 `sys.path`에 등록한다.
- **실시간은 국내 장 시간(09:00–15:30 KST)에만 흐른다.** 그 외 시간엔 시세/호가/차트가 REST 스냅샷이고 `/ws`는 연결만 되어 있고 조용하다. 장외에서 "실시간 갱신 안 됨"을 버그로 진단하지 말 것.

## env & 자격증명 (미묘한 버그 1순위 원인)
- `KIS_HTS_ENV` = `vps`(모의, **기본값**) | `prod`(실전) — 단일 기준.
- KIS는 **두 가지 표기**를 쓴다: `svr` = `prod`/`vps`(인증·URL)와 `env_dv` = `real`/`demo`(국내주식 함수의 TR_ID 선택). `Settings.env`(= `svr`)는 prod/vps, `Settings.env_dv`는 **매핑 프로퍼티**(prod→real, vps→demo). 인증은 `svr`, 국내주식 함수는 `env_dv`를 받는다. 둘을 혼동하면 주문이 조용히 깨진다.
- 자격증명: `config/{vps,prod}/.env`(gitignore; `config/.env.example`만 커밋). `config.py:load_credentials`가 읽고, `kis/auth.py:_apply_repo_credentials`가 `kis_auth._cfg`에 주입해 공유 `~/KIS/config/kis_devlp.yaml`을 오버라이드한다(yaml은 정적 URL/User-Agent만 제공).
- 토큰 캐시: `~/KIS/config/token_{계좌}_{YYYYMMDD}.json`, 계좌번호로 키잉(vps `50197966` vs prod `43553464`가 달라 env 접미사 불필요).

## 명령어
```bash
# 백엔드 (Python, uv)
cd backend && uv sync                                                   # 최초 1회
cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8787 --reload    # vps(모의)
cd backend && KIS_HTS_ENV=prod uv run uvicorn app.main:app --port 8787              # prod(실전 — 실주문!)

# 프론트 (Node)
cd frontend && npm install                # 최초 1회
cd frontend && npm run dev                # :1420
cd frontend && npm run build              # tsc -b && vite build  (검증 게이트 — 테스트 스위트 없음)
cd frontend && npm run lint               # oxlint
cd frontend && npx tauri dev              # 네이티브 앱 (Rust 필요)
cd frontend && npx tauri build --bundles app   # → src-tauri/target/release/bundle/macos/kis-hts.app
```
**자동화 테스트 스위트는 없다.** 변경 검증은 앱을 띄워 end-to-end로 확인한다(실시간 경로는 장 시간 필요).

## 작업 스타일 — 병행 에이전트 우선
작업이 독립적인 부분으로 나뉘면 순차로 다 하지 말고 **병행 서브에이전트**를 쓴다. 이 프로젝트에 맞는 분할: **백엔드(`backend/**`) ↔ 프론트(`frontend/src/**`)**(파일 영역이 겹치지 않아 공유 API 계약에 맞춰 동시 실행), 다중 파일 검색/리뷰, 기능별 구현. 충돌을 막게 계약/스펙을 먼저 정의한 뒤 결과를 직접 통합·검증한다.
- 주의(이번 세션 교훈): `fork` 서브에이전트는 이 코디네이터 컨텍스트와 *역할*까지 상속해, 구현 대신 조율로 새기 쉽다. 순수 구현 위임은 **fresh 일반 에이전트**에 자기완결 스펙을 주고 맡긴다. `fork`는 전체 대화 컨텍스트가 꼭 필요한 작업에만 쓴다.

## 전역 함정
- repo 폴더명을 바꾸면 백엔드 `.venv`의 절대경로(TLS CA 번들)가 깨진다 → `uv sync`로 재빌드. `node_modules`는 무영향.
- repo 루트는 상대경로로 해석(`config.py`의 `Path(__file__).resolve().parents[2]`)해 폴더명에 자동 적응한다.
- 결정의 "왜"가 담긴 살아있는 설계 로그: `docs/DESIGN.md`.
