"""종목검색 + 관심종목 CRUD 라우터.

- GET    /api/search?q=            종목 검색(코드/이름)
- GET    /api/watchlist            관심종목 {symbols, names}
- POST   /api/watchlist  {symbol}  추가 (+ WS 재구독)
- DELETE /api/watchlist/{symbol}   삭제 (+ WS 재구독)
"""
from __future__ import annotations

import contextlib

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app import store
from app.kis import symbols as sym
from app.kis.ws import ws_manager

router = APIRouter(tags=["symbols"])


class AddReq(BaseModel):
    symbol: str


class ReorderReq(BaseModel):
    symbols: list[str]


def _payload() -> dict:
    syms = store.get_watchlist()
    return {"symbols": syms, "names": sym.names_of(syms)}


@router.get("/search")
def search(q: str = Query("", min_length=0)) -> list[dict]:
    return sym.search(q)


@router.get("/watchlist")
def get_watchlist() -> dict:
    return _payload()


@router.post("/watchlist")
def add_watchlist(req: AddReq) -> dict:
    syms = store.add_symbol(req.symbol)
    with contextlib.suppress(Exception):
        ws_manager.resubscribe(syms)
    return _payload()


@router.delete("/watchlist/{symbol}")
def remove_watchlist(symbol: str) -> dict:
    syms = store.remove_symbol(symbol)
    with contextlib.suppress(Exception):
        ws_manager.resubscribe(syms)
    return _payload()


@router.post("/watchlist/reorder")
def reorder_watchlist(req: ReorderReq) -> dict:
    # 순서만 변경(종목 집합 동일) → WS 재구독 불필요
    store.reorder(req.symbols)
    return _payload()
