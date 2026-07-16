import { useEffect, useState } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { dir, num, pct } from "../format";
import type { FluctRankRow, VolumeRankRow } from "../types";

type RankTab = "volume" | "up" | "down";
type Row = VolumeRankRow | FluctRankRow;

const TABS: { key: RankTab; label: string }[] = [
  { key: "volume", label: "거래량" },
  { key: "up", label: "상승률" },
  { key: "down", label: "하락률" },
];

// 순위 탭 본문 (외곽 박스/타이틀은 AccountPanel이 제공)
export function Ranking() {
  const select = useStore((s) => s.select);
  const mergeNames = useStore((s) => s.mergeNames);
  const [tab, setTab] = useState<RankTab>("volume");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const req = tab === "volume" ? api.rankingVolume() : api.rankingFluctuation(tab);
    req
      .then((r) => {
        if (!alive) return;
        setRows(r);
        mergeNames(Object.fromEntries(r.map((x) => [x.symbol, x.name])));
      })
      .catch(() => alive && setRows([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [tab, mergeNames]);

  const pick = (r: Row) => {
    mergeNames({ [r.symbol]: r.name });
    select(r.symbol);
  };

  const showVol = tab === "volume";

  return (
    <>
      <div className="subtabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`subtab ${tab === t.key ? "on" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="rk-table">
        <div className={`rk-head ${showVol ? "with-vol" : ""}`}>
          <span className="ta-c">#</span>
          <span>종목</span>
          <span className="ta-r">현재가</span>
          <span className="ta-r">등락률</span>
          {showVol && <span className="ta-r">거래량</span>}
        </div>
        {loading && rows.length === 0 ? (
          <div className="bt-empty">불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div className="bt-empty">데이터 없음</div>
        ) : (
          rows.map((r) => {
            const d = dir(r.change_rate);
            return (
              <div
                key={r.symbol}
                className={`rk-row ${showVol ? "with-vol" : ""}`}
                onClick={() => pick(r)}
              >
                <span className="ta-c mono rk-rank">{r.rank}</span>
                <span className="rk-name">
                  <b>{r.name}</b>
                  <em>{r.symbol}</em>
                </span>
                <span className={`ta-r mono ${d}`}>{num(r.price)}</span>
                <span className={`ta-r mono ${d}`}>{pct(r.change_rate)}</span>
                {showVol && (
                  <span className="ta-r mono rk-vol">
                    {num((r as VolumeRankRow).volume)}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
