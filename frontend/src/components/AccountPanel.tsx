import { useState } from "react";
import { usePersisted } from "../persist";
import { useStore } from "../store";
import { Balance } from "./Balance";
import { Ranking } from "./Ranking";
import { Investor } from "./Investor";
import { Financials, Opinions, StockNews } from "./StockInfo";

type Tab = "bal" | "rank" | "invest" | "fin" | "opinion" | "news";
const TABS: { key: Tab; label: string }[] = [
  { key: "bal", label: "잔고" },
  { key: "rank", label: "순위" },
  { key: "invest", label: "투자자" },
  { key: "fin", label: "재무" },
  { key: "opinion", label: "의견" },
  { key: "news", label: "뉴스" },
];
const KEYS = new Set(TABS.map((t) => t.key));

// .ledger 좌측 셀: [잔고][순위][투자자][재무][의견][뉴스] 탭 패널
export function AccountPanel() {
  const [stored, setTab] = usePersisted<Tab>("acct.tab", "bal");
  const tab = KEYS.has(stored) ? stored : "bal"; // 옛 값("info") 등 무효 시 폴백
  const refreshAccount = useStore((s) => s.refreshAccount);
  const [nonce, setNonce] = useState(0);
  const [spinning, setSpinning] = useState(false);

  // 활성 탭만 새로고침: 잔고는 계좌 폴링 재조회, 나머지는 캐시 무시 강제 조회(signal 증가)
  const refresh = () => {
    setSpinning(true);
    setTimeout(() => setSpinning(false), 600);
    if (tab === "bal") void refreshAccount();
    else setNonce((n) => n + 1);
  };

  return (
    <div className="tabpanel">
      <div className="tab-head">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab-btn ${tab === t.key ? "on" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
        <button
          className={`tab-refresh ${spinning ? "spin" : ""}`}
          onClick={refresh}
          title="현재 탭 새로고침"
          aria-label="새로고침"
        >
          ↻
        </button>
      </div>
      {tab === "bal" && <Balance />}
      {tab === "rank" && <Ranking refreshSignal={nonce} />}
      {tab === "invest" && <Investor refreshSignal={nonce} />}
      {tab === "fin" && <Financials refreshSignal={nonce} />}
      {tab === "opinion" && <Opinions refreshSignal={nonce} />}
      {tab === "news" && <StockNews refreshSignal={nonce} />}
    </div>
  );
}
