import { useState } from "react";
import { Balance } from "./Balance";
import { Ranking } from "./Ranking";
import { Investor } from "./Investor";

type Tab = "bal" | "rank" | "invest";
const TABS: { key: Tab; label: string }[] = [
  { key: "bal", label: "잔고" },
  { key: "rank", label: "순위" },
  { key: "invest", label: "투자자" },
];

// .ledger 좌측 셀: [잔고][순위][투자자] 탭 패널
export function AccountPanel() {
  const [tab, setTab] = useState<Tab>("bal");
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
    </div>
  );
}
