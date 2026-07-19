import { usePersisted } from "../persist";
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
      </div>
      {tab === "bal" && <Balance />}
      {tab === "rank" && <Ranking />}
      {tab === "invest" && <Investor />}
      {tab === "fin" && <Financials />}
      {tab === "opinion" && <Opinions />}
      {tab === "news" && <StockNews />}
    </div>
  );
}
