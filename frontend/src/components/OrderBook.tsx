import { useStore } from "../store";
import { dir, num, pct } from "../format";
import type { Level } from "../types";

export function OrderBook({ symbol }: { symbol: string }) {
  const ob = useStore((s) => s.orderbooks[symbol]);
  const cur = useStore((s) => s.quotes[symbol]?.price ?? null);
  const setOrderDraft = useStore((s) => s.setOrderDraft);

  const asks = ob?.asks ?? [];
  const bids = ob?.bids ?? [];
  const maxQty = Math.max(
    1,
    ...asks.map((l) => l.qty ?? 0),
    ...bids.map((l) => l.qty ?? 0),
  );

  // 매도호가는 위(ask10→ask1), 매수호가는 아래(bid1→bid10)
  const asksTopDown = [...asks].reverse();

  const expPrice = ob?.exp_price ?? null;
  const expDir = dir(ob?.exp_change_rate);

  return (
    <div className="orderbook">
      <div className="panel-title">
        호가 <span className="ob-sub">10단계</span>
      </div>
      {expPrice != null && (
        <div className="ob-exp">
          <span className="ob-exp-lbl">예상체결</span>
          <span className={`ob-exp-price mono ${expDir}`}>{num(expPrice)}</span>
          <span className={`ob-exp-rate mono ${expDir}`}>{pct(ob?.exp_change_rate)}</span>
          <span className="ob-exp-qty mono">{num(ob?.exp_qty)}주</span>
        </div>
      )}
      <div className="ob-grid">
        <div className="ob-colhead">매도잔량</div>
        <div className="ob-colhead ta-c">호가</div>
        <div className="ob-colhead">매수잔량</div>

        {asksTopDown.map((l, i) => (
          <Row
            key={`a${i}`}
            side="ask"
            level={l}
            maxQty={maxQty}
            isCur={l.price === cur}
            onPrice={(p) => setOrderDraft({ price: p })}
          />
        ))}
        {bids.map((l, i) => (
          <Row
            key={`b${i}`}
            side="bid"
            level={l}
            maxQty={maxQty}
            isCur={l.price === cur}
            onPrice={(p) => setOrderDraft({ price: p })}
          />
        ))}
      </div>
      <div className="ob-total">
        <span className="down">총매도 {num(ob?.total_ask_qty)}</span>
        <span className="up">총매수 {num(ob?.total_bid_qty)}</span>
      </div>
    </div>
  );
}

function Row({
  side,
  level,
  maxQty,
  isCur,
  onPrice,
}: {
  side: "ask" | "bid";
  level: Level;
  maxQty: number;
  isCur: boolean;
  onPrice: (price: number) => void;
}) {
  const qty = level.qty ?? 0;
  const w = `${(qty / maxQty) * 100}%`;
  const priceCls = side === "ask" ? "down" : "up"; // 매도 blue, 매수 red

  return (
    <>
      <div className="ob-qty ask-cell">
        {side === "ask" && qty > 0 && (
          <>
            <span className="ob-bar down" style={{ width: w }} />
            <span className="mono ob-qnum">{num(qty)}</span>
          </>
        )}
      </div>
      <div
        className={`ob-price mono ta-c ${priceCls} ${isCur ? "cur" : ""} ${level.price ? "clickable" : ""}`}
        onClick={() => level.price && onPrice(level.price)}
        title={level.price ? "클릭하여 주문가로 지정" : undefined}
      >
        {level.price ? num(level.price) : ""}
      </div>
      <div className="ob-qty bid-cell">
        {side === "bid" && qty > 0 && (
          <>
            <span className="ob-bar up" style={{ width: w }} />
            <span className="mono ob-qnum">{num(qty)}</span>
          </>
        )}
      </div>
    </>
  );
}
