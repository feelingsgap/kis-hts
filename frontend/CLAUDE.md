# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

kis-hts의 React SPA. env/명령어는 루트 `../CLAUDE.md`를 먼저 볼 것. 이 문서는 프론트 고유 아키텍처를 다룬다. `npm run build`(tsc + vite)가 정확성 게이트다 — 테스트 스위트는 없다.

## 아키텍처
- React 19 + TypeScript + Vite + **zustand**. `store.ts`가 공유 상태 전부(quotes / orderbooks / balance / pending / watchlist(+names) / toasts)를 들고, `applyWs`가 `/ws` 메시지 `{tick | orderbook | fill}`를 처리한다(`fill`은 토스트 push + `refreshAccount`). `api.ts`가 백엔드 단일 계약(REST + 자동 재연결 `connectWs`)이다.
- **KR 색상 관례**: 상승 red(`--up`), 하락 blue(`--down`). 숫자/포맷/색상/호가단위 헬퍼는 `format.ts`(`num`/`signed`/`pct`/`dir`/`name`/`snapToTick`/`tickSize`). 주문 가격은 KRX 호가단위에 스냅해야 한다(`snapToTick`).
- 백엔드는 `:8787`; 실시간 갱신은 장 시간에만(루트 CLAUDE.md 참조).

## 레이아웃 불변식 (`App.tsx` + `index.css`) — 깨지 말 것
- 워크스페이스는 CSS grid: 상단 행 `[Watchlist | QuoteHeader+Chart | OrderBook]`, 하단 행 `[ledger | OrderPanel]`, 여기서 ledger = `AccountPanel`(잔고/순위/투자자 탭) + `OrdersPanel`(미체결/체결내역 탭).
- 중앙 컬럼은 **`minmax(0,1fr)` + `min-width:0`**로 창 리사이즈 시 넘치지 않고 줄어든다(이게 없으면 축소 대신 overflow).
- 호가창 `.ob-grid`는 **`grid-template-rows: auto repeat(20,1fr)`**로 패널 높이와 무관하게 20호가가 항상 보인다.

## Chart.tsx — 가장 복잡한 컴포넌트; 차트 손대기 전 전체를 읽을 것
- **ECharts**(tree-shaken `echarts/core` + 등록한 charts/components) 사용, lightweight-charts가 *아님*. 동적 다중 패널: 캔들 패널(candlestick + MA5/20/60 + 볼린저 오버레이) + 선택적 거래량/RSI/MACD 서브패널; `layout()`이 활성 토글로 grid 높이를 계산; 시리즈 순서가 안정적이라 tick 병합이 인덱스 정렬을 유지한다.
- `indicators.ts`가 SMA/EMA/볼린저/RSI(Wilder)/MACD를 계산 — 이웃 `auto-trading`의 `chart_indicators.py`와 일치하게 포팅. ECharts candlestick 데이터 순서는 **`[open, close, low, high]`**(OHLC 아님).
- **refetch vs re-render 분리**: 데이터 fetch 이펙트는 `[symbol, period]`에만 의존. 지표 토글은 refetch 없이 `candlesRef`로 옵션만 재구성(별도 `[panels]` 이펙트 + `panelsRef`). fetch deps에 `panels`를 넣지 말 것.
- **실시간 tick**: 줌 보존을 위해 `setOption({series}, {notMerge:false})`로 마지막 봉만 갱신. `loadedRef.symbol === symbol` 가드가 걸려 있고, symbol/period 변경 시 `candlesRef`를 비운다 — **이 가드가 없으면 종목 전환 시 새 종목 가격이 옛 종목의 마지막 봉에 쓰여 거대한 스파이크(봉 튀임)가 생긴다**.

## 네이티브 셸
`src-tauri/`가 Tauri v2 셸(identifier `com.kis.hts`); Rust 필요(`npx tauri dev|build`). prod 앱은 번들된 `dist/`를 로드하고 `127.0.0.1:8787` 백엔드에 붙는다(localhost는 신뢰 origin이라 앱에서의 http/ws 허용).
