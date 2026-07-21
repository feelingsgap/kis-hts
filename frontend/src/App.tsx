import { useEffect, useState } from "react";
import { api, connectWs } from "./api";
import { useStore } from "./store";
import { useSettings } from "./settings";
import { Watchlist } from "./components/Watchlist";
import { QuoteHeader } from "./components/QuoteHeader";
import { OrderBook } from "./components/OrderBook";
import { Chart } from "./components/Chart";
import { OrderPanel } from "./components/OrderPanel";
import { MarketBar } from "./components/MarketBar";
import { AccountPanel } from "./components/AccountPanel";
import { OrdersPanel } from "./components/OrdersPanel";
import { Toasts } from "./components/Toast";
import { Settings } from "./components/Settings";

export default function App() {
  const symbols = useStore((s) => s.symbols);
  const selected = useStore((s) => s.selected);
  const wsConnected = useStore((s) => s.wsConnected);
  const env = useStore((s) => s.env);
  const colorScheme = useSettings((s) => s.colorScheme);
  const [showSettings, setShowSettings] = useState(false);
  const {
    setWatchlist,
    setQuote,
    setOrderBook,
    applyWs,
    setWsConnected,
    setEnv,
    refreshAccount,
    selectAdjacent,
    setOrderDraft,
  } = useStore.getState();

  // 서버 env(vps 모의 / prod 실전) 조회 → 상단 배지 반영
  useEffect(() => {
    api
      .health()
      .then((h) => setEnv(h.env))
      .catch(() => {});
  }, [setEnv]);

  // 등락 색상 관례 적용 (한국식/글로벌식) → :root[data-scheme]
  useEffect(() => {
    document.documentElement.dataset.scheme = colorScheme;
  }, [colorScheme]);

  // 초기 로드: 관심종목 + 스냅샷 시세
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const wl = await api.watchlist();
        if (!alive) return;
        setWatchlist(wl.symbols, wl.names);
        for (const sym of wl.symbols) {
          try {
            setQuote(await api.quote(sym));
          } catch {
            /* 개별 실패 무시 */
          }
        }
      } catch {
        /* 백엔드 미기동 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [setWatchlist, setQuote]);

  // WS 연결
  useEffect(() => connectWs(applyWs, setWsConnected), [applyWs, setWsConnected]);

  // 키보드 단축키: ↑/↓ 관심종목 이동, B/S 매수·매도 (입력창 포커스 시 무시)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectAdjacent(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        selectAdjacent(-1);
      } else if (e.code === "KeyB") {
        setOrderDraft({ side: "buy" });
      } else if (e.code === "KeyS") {
        setOrderDraft({ side: "sell" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectAdjacent, setOrderDraft]);

  // 계좌(잔고/미체결) 초기 + 주기 갱신. 주문 접수/체결은 WS가 즉시 refreshAccount를 트리거하고
  // 보유 P&L은 틱에서 파생(Balance)하므로, 폴백 폴링은 15초로 완화(rate limiter 부하 감소).
  useEffect(() => {
    refreshAccount();
    const t = setInterval(refreshAccount, 15000);
    return () => clearInterval(t);
  }, [refreshAccount]);

  // 선택 종목의 호가 스냅샷 (alive 가드: 종목 전환 중 도착한 옛 응답이 새 선택을 덮어쓰지 않게)
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    api
      .orderbook(selected)
      .then((ob) => {
        if (alive) setOrderBook(ob);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [selected, setOrderBook]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          KIS <span className="brand-accent">HTS</span>
          <span className={`brand-env ${env === "prod" ? "prod" : ""}`}>
            {env === "prod" ? "실전투자" : "모의투자"}
          </span>
        </div>
        <MarketBar />
        <div className="topbar-right">
          <div className={`ws-status ${wsConnected ? "on" : "off"}`}>
            <span className="dot" /> {wsConnected ? "실시간 연결" : "연결 대기"}
          </div>
          <button
            className="settings-open"
            onClick={() => setShowSettings(true)}
            aria-label="설정"
            title="설정"
          >
            ⚙
          </button>
        </div>
      </header>

      <div className="workspace">
        {selected ? (
          <>
            <div className="main-area">
              <aside className="col-left">
                <Watchlist />
              </aside>
              <section className="col-center">
                <QuoteHeader symbol={selected} />
                <Chart symbol={selected} />
              </section>
              <aside className="col-right">
                <OrderBook symbol={selected} />
              </aside>
            </div>
            <div className="bottom-area">
              <div className="ledger">
                <AccountPanel />
                <OrdersPanel />
              </div>
              <OrderPanel symbol={selected} />
            </div>
          </>
        ) : (
          <div className="empty">
            {symbols.length ? "종목을 선택하세요" : "백엔드(:8787)에 연결 중…"}
          </div>
        )}
      </div>
      <Toasts />
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
