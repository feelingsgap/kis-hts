"""1분봉 스토어 — 실시간 틱 누적 + SQLite 영속.

실시간 체결틱(H0STCNT0)을 1분봉으로 누적(on_tick)하고, REST 백필분과 함께
SQLite(~/KIS/config/kis_hts.sqlite, minute_bars 테이블)에 저장한다. 차트 요청은
저장된 1분봉을 읽어 N분으로 집계(요청마다 페이지네이션하던 기존 방식 대체).

- 틱은 장중·구독중 종목만 흐르므로 라이브/이후 봉만 채운다. 과거 히스토리는 REST 백필.
- on_tick은 WS 스레드에서, get_ones/count는 요청 스레드에서 호출 → 모듈 lock으로 보호.
- 현재(진행 중) 1분봉은 메모리(_live)에 두고, 분이 바뀌면 완료봉을 SQLite에 flush.
"""
from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

_DB = Path.home() / "KIS" / "config" / "kis_hts.sqlite"
_lock = threading.Lock()
_live: dict[str, dict] = {}  # symbol -> 현재(진행 중) 1분봉


def _conn() -> sqlite3.Connection:
    _DB.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(_DB)
    c.execute(
        "CREATE TABLE IF NOT EXISTS minute_bars ("
        " symbol TEXT, date TEXT, time TEXT,"
        " open INTEGER, high INTEGER, low INTEGER, close INTEGER, volume INTEGER,"
        " PRIMARY KEY(symbol, date, time))"
    )
    return c


def _upsert(c: sqlite3.Connection, symbol: str, bars: list[dict]) -> None:
    c.executemany(
        "INSERT OR REPLACE INTO minute_bars(symbol,date,time,open,high,low,close,volume)"
        " VALUES (?,?,?,?,?,?,?,?)",
        [
            (symbol, b["date"], b["time"], b["open"], b["high"], b["low"], b["close"], b["volume"])
            for b in bars
        ],
    )


def save_bars(symbol: str, bars: list[dict]) -> None:
    """1분봉 벌크 upsert (REST 백필용). date/time 없는 항목은 건너뜀."""
    rows = [b for b in bars if b.get("date") and b.get("time")]
    if not rows:
        return
    with _lock, _conn() as c:
        _upsert(c, symbol, rows)
        c.commit()


def on_tick(symbol: str | None, date: str | None, hhmmss: str, price: int | None, vol: int | None) -> None:
    """체결틱을 현재 1분봉에 누적. 분이 바뀌면 이전 봉을 SQLite에 flush한다."""
    if not symbol or not date or not hhmmss or len(hhmmss) < 4 or price is None:
        return
    t = f"{hhmmss[:4]}00"  # 분 버킷(HHMM00)
    v = vol or 0
    with _lock:
        bar = _live.get(symbol)
        if bar is None or bar["date"] != date or bar["time"] != t:
            done = bar
            _live[symbol] = {
                "date": date, "time": t,
                "open": price, "high": price, "low": price, "close": price, "volume": v,
            }
            if done is not None:  # 완료된 이전 분봉 flush
                try:
                    with _conn() as c:
                        _upsert(c, symbol, [done])
                        c.commit()
                except sqlite3.Error:
                    pass
        else:
            bar["high"] = max(bar["high"], price)
            bar["low"] = min(bar["low"], price)
            bar["close"] = price
            bar["volume"] += v


def get_ones(symbol: str, limit: int = 800) -> list[dict]:
    """저장된 1분봉(최근 limit) + 현재 진행 봉을 (date,time) 오름차순으로 반환."""
    with _lock, _conn() as c:
        rows = c.execute(
            "SELECT date,time,open,high,low,close,volume FROM minute_bars"
            " WHERE symbol=? ORDER BY date DESC, time DESC LIMIT ?",
            (symbol, limit),
        ).fetchall()
        cur = _live.get(symbol)
        cur_copy = dict(cur) if cur else None
    bars = {
        (r[0], r[1]): {
            "date": r[0], "time": r[1],
            "open": r[2], "high": r[3], "low": r[4], "close": r[5], "volume": r[6],
        }
        for r in rows
    }
    if cur_copy:  # 진행 중 봉 우선
        bars[(cur_copy["date"], cur_copy["time"])] = cur_copy
    return [bars[k] for k in sorted(bars.keys())]


def count(symbol: str) -> int:
    with _lock, _conn() as c:
        return c.execute("SELECT COUNT(*) FROM minute_bars WHERE symbol=?", (symbol,)).fetchone()[0]
