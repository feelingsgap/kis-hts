"""로컬 영속화 (SQLite) — 관심종목 저장.

표준 라이브러리 sqlite3만 사용. DB는 ~/KIS/config/kis_hts.sqlite.
스레드 안전을 위해 매 호출 커넥션을 열고 닫는다(경량).
"""
from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

_DB = Path.home() / "KIS" / "config" / "kis_hts.sqlite"
_lock = threading.Lock()
_DEFAULT = ["005930", "000660", "035420"]


def _conn() -> sqlite3.Connection:
    _DB.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(_DB)
    c.execute(
        "CREATE TABLE IF NOT EXISTS watchlist ("
        " symbol TEXT PRIMARY KEY,"
        " pos INTEGER NOT NULL DEFAULT 0,"
        " added_at TEXT DEFAULT (datetime('now'))"
        ")"
    )
    return c


def _seed_if_empty(c: sqlite3.Connection) -> None:
    n = c.execute("SELECT COUNT(*) FROM watchlist").fetchone()[0]
    if n == 0:
        c.executemany(
            "INSERT OR IGNORE INTO watchlist(symbol, pos) VALUES (?, ?)",
            [(s, i) for i, s in enumerate(_DEFAULT)],
        )
        c.commit()


def get_watchlist() -> list[str]:
    with _lock, _conn() as c:
        _seed_if_empty(c)
        rows = c.execute("SELECT symbol FROM watchlist ORDER BY pos, added_at").fetchall()
        return [r[0] for r in rows]


def add_symbol(symbol: str) -> list[str]:
    symbol = (symbol or "").strip()
    with _lock, _conn() as c:
        _seed_if_empty(c)
        maxpos = c.execute("SELECT COALESCE(MAX(pos), -1) FROM watchlist").fetchone()[0]
        c.execute(
            "INSERT OR IGNORE INTO watchlist(symbol, pos) VALUES (?, ?)", (symbol, maxpos + 1)
        )
        c.commit()
        rows = c.execute("SELECT symbol FROM watchlist ORDER BY pos, added_at").fetchall()
        return [r[0] for r in rows]


def remove_symbol(symbol: str) -> list[str]:
    with _lock, _conn() as c:
        c.execute("DELETE FROM watchlist WHERE symbol = ?", (symbol,))
        c.commit()
        rows = c.execute("SELECT symbol FROM watchlist ORDER BY pos, added_at").fetchall()
        return [r[0] for r in rows]


def reorder(symbols: list[str]) -> list[str]:
    """관심종목 순서 변경. 전달된 순서대로 pos를 재부여한다.

    누락된(=현재 저장돼 있으나 목록에 없는) 종목은 뒤에 원래 순서로 보존한다.
    """
    with _lock, _conn() as c:
        _seed_if_empty(c)
        existing = [r[0] for r in c.execute("SELECT symbol FROM watchlist ORDER BY pos, added_at")]
        # 전달 순서 우선, 그 뒤에 목록에 없던 기존 종목
        ordered = [s for s in symbols if s in existing]
        ordered += [s for s in existing if s not in ordered]
        for i, s in enumerate(ordered):
            c.execute("UPDATE watchlist SET pos = ? WHERE symbol = ?", (i, s))
        c.commit()
        rows = c.execute("SELECT symbol FROM watchlist ORDER BY pos, added_at").fetchall()
        return [r[0] for r in rows]
