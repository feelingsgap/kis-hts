"""잔고/계좌 라우터 (P3).

- GET /api/balance             주식잔고 (보유종목 + 요약)
- GET /api/psbl-order/{symbol} 매수가능조회
"""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.kis import rest

router = APIRouter(tags=["account"])


@router.get("/balance")
def get_balance() -> dict:
    return rest.balance()


@router.get("/psbl-order/{symbol}")
def get_psbl_order(
    symbol: str,
    price: int = Query(0, ge=0),
    ord_dvsn: str = Query("00", pattern="^(00|01)$"),
) -> dict:
    return rest.psbl_order(symbol, price, ord_dvsn)
