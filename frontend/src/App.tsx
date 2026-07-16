import { useEffect, useState } from "react";
import { api, connectWs } from "./api";
import { useStore } from "./store";
import { Watchlist } from "./components/Watchlist";
import { QuoteHeader } from "./components/QuoteHeader";
import { OrderBook } from "./components/OrderBook";
import { Chart } from "./components/Chart";
import { OrderPanel } from "./components/OrderPanel";
import { AccountPanel } from "./components/AccountPanel";
import { OrdersPanel } from "./components/OrdersPanel";
import { Toasts } from "./components/Toast";

export default function App() {
  const symbols = useStore((s) => s.symbols);
  const selected = useStore((s) => s.selected);
  const wsConnected = useStore((s) => s.wsConnected);
  const { setWatchlist, setQuote, setOrderBook, applyWs, setWsConnected, refreshAccount } =
    useStore.getState();
  const [env, setEnv] = useState<string>("vps");

  // 서버 env(vps 모의 / prod 실전) 조회 → 상단 배지 반영
  useEffect(() => {
    api
      .health()
      .then((h) => setEnv(h.env))
      .catch(() => {});
  }, []);

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

  // 계좌(잔고/미체결) 초기 + 주기 갱신
  useEffect(() => {
    refreshAccount();
    const t = setInterval(refreshAccount, 5000);
    return () => clearInterval(t);
  }, [refreshAccount]);

  // 선택 종목의 호가 스냅샷
  useEffect(() => {
    if (!selected) return;
    api
      .orderbook(selected)
      .then(setOrderBook)
      .catch(() => {});
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
        <div className={`ws-status ${wsConnected ? "on" : "off"}`}>
          <span className="dot" /> {wsConnected ? "실시간 연결" : "연결 대기"}
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
    </div>
  );
}
