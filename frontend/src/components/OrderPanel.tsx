import { useEffect, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { name, num, snapToTick, tickSize } from "../format";
import type { OrdDvsn, PsblOrder, Side } from "../types";
import { ConfirmDialog } from "./OrderConfirm";

export function OrderPanel({ symbol }: { symbol: string }) {
  const draft = useStore((s) => s.orderDraft);
  const setOrderDraft = useStore((s) => s.setOrderDraft);
  const refreshAccount = useStore((s) => s.refreshAccount);
  const curPrice = useStore((s) => s.quotes[symbol]?.price ?? null);
  // 매도 가능수량: 잔고의 해당 종목 주문가능수량(미체결 매도분 반영)
  const sellable = useStore(
    (s) => s.balance?.holdings.find((h) => h.symbol === symbol)?.orderable_qty ?? 0,
  );

  const [ordDvsn, setOrdDvsn] = useState<OrdDvsn>("00");
  const [qty, setQty] = useState<number>(1);
  const [psbl, setPsbl] = useState<PsblOrder | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const side = draft.side;
  const rawPrice = draft.price ?? curPrice ?? 0;
  const price = ordDvsn === "01" ? 0 : snapToTick(rawPrice); // 제출/조회용 (호가단위 스냅)

  // 종목 바뀌면 주문가 초기화
  useEffect(() => {
    setOrderDraft({ price: null });
    setMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // 주문가 미설정 시 현재가(호가단위 스냅)를 기본값으로 (이후 실시간 틱은 덮어쓰지 않음)
  useEffect(() => {
    if (draft.price == null && curPrice != null) setOrderDraft({ price: snapToTick(curPrice) });
  }, [curPrice, draft.price, setOrderDraft]);

  // 매수가능 조회 (매수 + 가격 변경 시)
  useEffect(() => {
    if (side !== "buy") return;
    let alive = true;
    api
      .psblOrder(symbol, price, ordDvsn)
      .then((p) => alive && setPsbl(p))
      .catch(() => alive && setPsbl(null));
    return () => {
      alive = false;
    };
  }, [symbol, side, price, ordDvsn]);

  // 발주 전 검증 → 확인 모달
  const openConfirm = () => {
    setMsg(null);
    if (ordDvsn === "00" && (!price || price <= 0)) {
      setMsg({ ok: false, text: "가격을 입력하세요" });
      return;
    }
    if (!qty || qty <= 0) {
      setMsg({ ok: false, text: "수량을 확인하세요" });
      return;
    }
    if (side === "sell" && sellable > 0 && qty > sellable) {
      setMsg({ ok: false, text: `가능수량(${num(sellable)}주)을 초과합니다` });
      return;
    }
    setConfirm(true);
  };

  const doPlace = async () => {
    setConfirm(false);
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.placeOrder({ side, symbol, qty, price, ord_dvsn: ordDvsn });
      setMsg({ ok: true, text: `${side === "buy" ? "매수" : "매도"} 주문 접수 (${r.order_no})` });
      await refreshAccount();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "주문 실패" });
    } finally {
      setBusy(false);
    }
  };

  // 호가단위 단위로 증감
  const step = (dir: number) => {
    const base = snapToTick(draft.price ?? curPrice ?? 0);
    setOrderDraft({ price: Math.max(0, base + dir * tickSize(base)) });
  };

  // 수량 프리셋: 매수는 최대매수수량, 매도는 가능수량 기준 비율
  const maxQty = side === "buy" ? psbl?.max_buy_qty ?? 0 : sellable;
  const setPct = (pct: number) => {
    const q = Math.floor((maxQty * pct) / 100);
    if (q > 0) setQty(q);
  };

  return (
    <div className="order-panel">
      <div className="op-tabs">
        <button className={`op-tab buy ${side === "buy" ? "on" : ""}`} onClick={() => tab("buy")}>
          매수
        </button>
        <button className={`op-tab sell ${side === "sell" ? "on" : ""}`} onClick={() => tab("sell")}>
          매도
        </button>
      </div>

      <div className="op-body">
        <div className="op-sym">
          <b>{name(symbol)}</b> <span className="mono">{symbol}</span>
        </div>

        <label className="op-row">
          <span>유형</span>
          <div className="op-seg">
            <button className={ordDvsn === "00" ? "on" : ""} onClick={() => setOrdDvsn("00")}>
              지정가
            </button>
            <button className={ordDvsn === "01" ? "on" : ""} onClick={() => setOrdDvsn("01")}>
              시장가
            </button>
          </div>
        </label>

        <label className="op-row">
          <span>가격</span>
          <div className="op-stepper">
            <button onClick={() => step(-1)} disabled={ordDvsn === "01"}>
              −
            </button>
            <input
              className="mono"
              type="number"
              value={ordDvsn === "01" ? "" : (draft.price ?? "")}
              placeholder={ordDvsn === "01" ? "시장가" : ""}
              disabled={ordDvsn === "01"}
              onChange={(e) => setOrderDraft({ price: e.target.value ? +e.target.value : null })}
            />
            <button onClick={() => step(1)} disabled={ordDvsn === "01"}>
              +
            </button>
          </div>
        </label>

        <label className="op-row">
          <span>수량</span>
          <input
            className="mono"
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, +e.target.value || 1))}
          />
        </label>

        <div className="op-presets">
          {[25, 50, 100].map((p) => (
            <button key={p} onClick={() => setPct(p)} disabled={maxQty <= 0}>
              {side === "sell" && p === 100 ? "전량" : `${p}%`}
            </button>
          ))}
        </div>

        <div className="op-info">
          {side === "buy" ? (
            <>
              <span>주문가능</span>
              <b className="mono">{num(psbl?.orderable_cash)}원</b>
              <span>최대</span>
              <b className="mono">{num(psbl?.max_buy_qty)}주</b>
            </>
          ) : (
            <>
              <span>가능수량</span>
              <b className="mono">{num(sellable)}주</b>
              <span>주문금액</span>
              <b className="mono">{num(price * qty)}원</b>
            </>
          )}
        </div>

        <button className={`op-submit ${side}`} onClick={openConfirm} disabled={busy}>
          {busy ? "처리 중…" : side === "buy" ? "매수 주문" : "매도 주문"}
        </button>

        {msg && <div className={`op-msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</div>}
      </div>

      {confirm && (
        <ConfirmDialog
          title={side === "buy" ? "매수 주문 확인" : "매도 주문 확인"}
          rows={[
            { label: "종목", value: `${name(symbol)} (${symbol})` },
            { label: "구분", value: side === "buy" ? "매수" : "매도", tone: side === "buy" ? "up" : "down" },
            { label: "유형", value: ordDvsn === "01" ? "시장가" : "지정가" },
            { label: "가격", value: ordDvsn === "01" ? "시장가" : `${num(price)}원` },
            { label: "수량", value: `${num(qty)}주` },
            {
              label: "주문금액",
              value: ordDvsn === "01" ? "-" : `${num(price * qty)}원`,
              strong: true,
            },
          ]}
          confirmLabel={side === "buy" ? "매수 확정" : "매도 확정"}
          tone={side}
          busy={busy}
          onConfirm={doPlace}
          onClose={() => setConfirm(false)}
        />
      )}
    </div>
  );

  function tab(s: Side) {
    setOrderDraft({ side: s });
    setMsg(null);
  }
}
