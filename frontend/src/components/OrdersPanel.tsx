import { useState } from "react";
import { useStore } from "../store";
import { PendingOrders } from "./PendingOrders";
import { FilledOrders } from "./FilledOrders";

type Tab = "pending" | "filled";

// .ledger 우측 셀: [미체결][체결내역] 탭 패널
export function OrdersPanel() {
  const pendingCount = useStore((s) => s.pending.length);
  const [tab, setTab] = useState<Tab>("pending");

  return (
    <div className="tabpanel">
      <div className="tab-head">
        <button
          className={`tab-btn ${tab === "pending" ? "on" : ""}`}
          onClick={() => setTab("pending")}
        >
          미체결 <span className="pd-count">{pendingCount}</span>
        </button>
        <button
          className={`tab-btn ${tab === "filled" ? "on" : ""}`}
          onClick={() => setTab("filled")}
        >
          체결내역
        </button>
      </div>
      {tab === "pending" ? <PendingOrders /> : <FilledOrders active={tab === "filled"} />}
    </div>
  );
}
