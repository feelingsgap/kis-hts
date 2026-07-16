import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { api } from "../api";
import { useStore } from "../store";
import { dir, name, num, pct } from "../format";
import type { SearchResult } from "../types";

export function Watchlist() {
  const symbols = useStore((s) => s.symbols);
  const quotes = useStore((s) => s.quotes);
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  const refreshWatchlist = useStore((s) => s.refreshWatchlist);
  const reorderWatchlist = useStore((s) => s.reorderWatchlist);
  const mergeNames = useStore((s) => s.mergeNames);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragSym, setDragSym] = useState<string | null>(null);
  const [overSym, setOverSym] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // 드래그로 순서 변경: dragSym을 targetSym 위치로 이동
  const drop = (targetSym: string) => {
    const from = dragSym;
    setDragSym(null);
    setOverSym(null);
    if (!from || from === targetSym) return;
    const arr = symbols.filter((s) => s !== from);
    const ti = arr.indexOf(targetSym);
    arr.splice(ti < 0 ? arr.length : ti, 0, from);
    reorderWatchlist(arr);
  };

  // 검색(디바운스)
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      api
        .search(term)
        .then((r) => {
          if (!alive) return;
          setResults(r.slice(0, 8));
          setOpen(true);
        })
        .catch(() => alive && setResults([]));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  // 바깥 클릭 시 드롭다운 닫기
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const add = async (r: SearchResult) => {
    mergeNames({ [r.symbol]: r.name });
    setQ("");
    setResults([]);
    setOpen(false);
    try {
      await api.addWatch(r.symbol);
      await refreshWatchlist();
      select(r.symbol);
    } catch {
      /* 이미 존재 등 무시 */
    }
  };

  const remove = async (sym: string, e: ReactMouseEvent) => {
    e.stopPropagation();
    setBusy(sym);
    try {
      await api.removeWatch(sym);
      await refreshWatchlist();
    } catch {
      /* 무시 */
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="watchlist">
      <div className="panel-title">관심종목</div>

      <div className="wl-search" ref={boxRef}>
        <input
          className="wl-search-input"
          placeholder="종목명·코드 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
        />
        {open && results.length > 0 && (
          <ul className="wl-results">
            {results.map((r) => (
              <li key={r.symbol} className="wl-result" onClick={() => add(r)}>
                <span className="wl-result-name">{r.name}</span>
                <span className="wl-result-meta mono">
                  {r.symbol} · {r.market}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="wl-head">
        <span>종목</span>
        <span className="ta-r">현재가</span>
        <span className="ta-r">등락률</span>
      </div>
      <ul className="wl-list">
        {symbols.map((sym) => {
          const qt = quotes[sym];
          const d = dir(qt?.change);
          return (
            <li
              key={sym}
              className={`wl-row ${selected === sym ? "sel" : ""} ${
                overSym === sym && dragSym && dragSym !== sym ? "over" : ""
              } ${dragSym === sym ? "dragging" : ""}`}
              onClick={() => select(sym)}
              draggable
              onDragStart={() => setDragSym(sym)}
              onDragOver={(e) => {
                e.preventDefault();
                if (overSym !== sym) setOverSym(sym);
              }}
              onDrop={() => drop(sym)}
              onDragEnd={() => {
                setDragSym(null);
                setOverSym(null);
              }}
            >
              <span className="wl-name">
                <b>{name(sym)}</b>
                <em>{sym}</em>
              </span>
              <span className={`ta-r mono ${d}`}>{num(qt?.price)}</span>
              <span className={`ta-r mono ${d}`}>{pct(qt?.change_rate)}</span>
              <button
                className="wl-remove"
                title="관심종목에서 삭제"
                disabled={busy === sym}
                onClick={(e) => remove(sym, e)}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
