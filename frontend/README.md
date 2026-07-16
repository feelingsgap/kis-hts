# kis-hts-frontend

KIS OpenAPI macOS HTS의 프론트엔드. React 19 + TypeScript + Vite + zustand, 차트는 ECharts, 네이티브 셸은 Tauri v2. 로컬 백엔드(`:8787`)에 REST + WebSocket으로 연결한다. 상세 설계는 [`../docs/DESIGN.md`](../docs/DESIGN.md).

## 실행
```bash
npm install                 # 최초 1회
npm run dev                 # 개발 서버 → http://localhost:1420
npm run build               # 타입체크(tsc) + 빌드
npm run lint                # oxlint
npx tauri dev               # 네이티브 앱(개발) — Rust 필요
npx tauri build --bundles app   # .app 패키징 → src-tauri/target/release/bundle/macos/
```
> 백엔드(`:8787`)가 먼저 떠 있어야 데이터가 표시된다. 실시간(체결/호가/체결통보)은 장중(09:00~15:30)에만 유입.

## 화면 구성
- **상단 3열**: 관심종목 | 현재가+차트 | 호가창(10단계)
- **하단**: (잔고 / 순위 / 투자자 탭) · (미체결 / 체결내역 탭) | 매수·매도 주문 패널
- 상단 배지는 서버 env를 반영해 **모의투자 / 실전투자(빨강)** 표시

## 주요 컴포넌트 (`src/components/`)
| 컴포넌트 | 내용 |
|---|---|
| `Watchlist` | 관심종목 — 검색·추가/삭제·드래그 순서변경 |
| `QuoteHeader` | 현재가·등락·OHLC (컴팩트) |
| `Chart` | ECharts 캔들 + MA5/20/60 + 볼린저 + RSI + MACD, 기간(1분/일/주/월)·지표 토글, 실시간 봉 갱신 |
| `OrderBook` | 10호가 + 잔량바 + 예상체결 (가격 클릭 → 주문가) |
| `OrderPanel` | 매수/매도 · 지정가/시장가 · 호가단위 스냅 · 매수가능 |
| `Balance` | 예수금·평가·실현손익·보유종목 |
| `PendingOrders` / `FilledOrders` | 미체결(정정/취소) · 체결내역 |
| `Ranking` / `Investor` | 거래량·등락 순위 / 외국인·기관·개인 순매수 |
| `Toast` | 체결통보 토스트 |

## 기타 (`src/`)
- `api.ts` — 백엔드 REST/WS 클라이언트 (자동 재연결)
- `store.ts` — zustand 전역 상태 (시세·잔고·관심종목·토스트)
- `indicators.ts` — 지표 계산 (SMA/EMA/볼린저/RSI(Wilder)/MACD)
- `format.ts` — 숫자·색상(상승 red/하락 blue)·호가단위(`snapToTick`) 유틸
- `src-tauri/` — Tauri 네이티브 셸 (식별자 `com.kis.hts`)
