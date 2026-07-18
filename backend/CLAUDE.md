# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

kis-hts의 로컬 FastAPI sidecar 백엔드. env/자격증명/명령어는 루트 `../CLAUDE.md`를 먼저 읽을 것. 이 문서는 백엔드 고유 아키텍처와 KIS 함정을 다룬다.

## 아키텍처
- `open-trading-api`의 `kis_auth`를 래핑한다(**모듈 전역 상태**: `_TRENV`, `_base_headers` → 프로세스당 사실상 단일 계좌). `kis/auth.py:_load_ka()`가 지연 import(자격증명 없어도 `/health`는 뜸)하고 repo 자격증명을 딱 한 번 주입한다.
- **모든 KIS 조회는 `kis/rest.py`의 `_kis()` 래퍼를 거친다**: 단일 직렬 rate limiter(`_limiter.wait()`, `vps 0.8s / prod 0.07s`)로 호출을 직렬화하고, 그래도 KIS 모의 서버가 동시 버스트에서 간헐 반환하는 `EGW00201`(초당 초과)을 stdout에서 감지해 백오프 후 재시도한다(실측: 0.55s ~17%, 0.8s ~8% 실패 → 재시도로 0%). **간격만으론 0%가 안 되므로 재시도가 핵심.** 주문(`place_order`/정정취소)은 상태 변경이라 `_kis`를 쓰지 않고 `_limiter.wait()`만 직접 쓴다(무분별 재시도 금지). 다중 호출 흐름이 느린 건 이 직렬화 때문이지 버그가 아니다.
- `kis/ws.py:KisWsManager`가 open-trading-api의 `KISWebSocket`(블로킹 `asyncio.run` 루프)을 **daemon 스레드**에서 돌린다. 콜백이 프레임을 정규화해 `realtime.hub.publish_threadsafe(...)`로 보낸다. 관심종목 변경 시 `resubscribe()`가 라이브러리 전역 `open_map`을 비우고 **라이브 소켓을 끊어** 러너가 재연결+재구독하게 한다. 종목 상한 ≈19(종목당 2구독 + 체결통보 → KIS 40구독 한도).
- 라우터(`routers/{quotes,account,orders,symbols,analysis}.py`)는 얇고, 로직은 `kis/{rest,symbols,analysis}.py`에 있다. **엔드포인트 추가** = `kis/*.py`에 함수 + `routers/*.py`에 라우트 + `main.py`에 `include_router`.
- `store.py` = 관심종목용 stdlib `sqlite3`(`~/KIS/config/kis_hts.sqlite`), `pos` 컬럼으로 정렬(드래그 순서변경).

## 여기 반영된 KIS 함정 (비자명, 삽질로 배움)
- **`env_dv` vs `svr`** — 루트 CLAUDE.md 참조. `rest.py:_env()`는 국내주식 함수용 `Settings.env_dv`(real/demo)를 반환하고, 인증은 `Settings.svr`(prod/vps)를 쓴다.
- **모의(vps): `inquire_psbl_rvsecncl`(정정취소가능조회)가 빈값 반환** → 미체결은 `inquire_daily_ccld(ccld_dvsn="02")`로 조회(`rest.py:pending_orders`; 잔량 = `rmn_qty`, `sll_buy_dvsn_cd` 02=매수/01=매도).
- **키 대소문자**: 주문 응답은 대문자 키(`ODNO`, `KRX_FWDG_ORD_ORGNO`), 조회 응답은 소문자 → `rest.py:_get()`은 대소문자 무시.
- **주문 에러**: `order_cash`/`order_rvsecncl`는 실패를 stdout에 print하고 빈 DataFrame을 반환 → 주문은 stdout을 캡처(`contextlib.redirect_stdout`)해 `msg1`을 surface.
- **`realized_pnl`**: 모의는 `inquire_balance_rlz_pl` 미지원 → 당일 체결 라운드트립으로 **근사**(수수료·세금 제외).
- **차트**: KIS는 호출당 ≤100봉 반환. `routers/quotes.py:get_daily_chart`가 주기(D/W/M)별로 기본 기간을 넓혀 각 100봉을 채운다(MA60 계산 가능하게).
- **토큰 캐시 격리**(`auth.py:_isolate_token_cache`): `ka.token_tmp`를 env별 계좌 파일로 오버라이드. open-trading-api는 `read_token(acct_no=None)`이 두 env 모두 `my_acct_stock` 기준이라 vps가 prod 토큰을 재사용해 `EGW00123`(만료)가 난다. env별 계좌가 달라 파일명 접미사는 쓰지 않는다.
- **체결통보** `H0STCNI0`(real)/`H0STCNI9`(demo)는 AES 암호화(엔진이 복호화)이고 종목이 아니라 **HTS ID**로 구독(`ws.py`).
- **주문은 KRX 호가단위에 맞아야 한다**(프론트가 스냅; 안 맞으면 호가단위 오류).
