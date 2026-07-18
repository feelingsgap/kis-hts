"""시세/차트 라우터 (P1~P2).

- GET /api/quote/{symbol}          현재가 (inquire_price)
- GET /api/orderbook/{symbol}      호가 10단계 (inquire_asking_price_exp_ccn)
- GET /api/chart/{symbol}/daily    일/주/월봉 (inquire_daily_itemchartprice)

sync(def) 엔드포인트 → FastAPI가 threadpool에서 실행(블로킹 requests 대응).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Query

from app.kis import rest

router = APIRouter(tags=["quotes"])


@router.get("/quote/{symbol}")
def get_quote(symbol: str, market: str = "J") -> dict:
    data = rest.current_price(symbol, market)
    if not data:
        raise HTTPException(status_code=404, detail=f"시세 없음: {symbol}")
    return data


@router.get("/orderbook/{symbol}")
def get_orderbook(symbol: str, market: str = "J") -> dict:
    data = rest.orderbook(symbol, market)
    if not data:
        raise HTTPException(status_code=404, detail=f"호가 없음: {symbol}")
    return data


@router.get("/chart/{symbol}/daily")
def get_daily_chart(
    symbol: str,
    market: str = "J",
    period: str = Query("D", pattern="^[DWMY]$"),
    start: str | None = Query(None, pattern="^[0-9]{8}$"),
    end: str | None = Query(None, pattern="^[0-9]{8}$"),
    adj: str = Query("0", pattern="^[01]$"),
) -> dict:
    today = datetime.now()
    end = end or today.strftime("%Y%m%d")
    # 주기별로 기간을 넓혀 API 최대치(100봉)를 채운다 → 이평선(MA60) 인식 가능
    if not start:
        span = {"D": 220, "W": 1200, "M": 4600, "Y": 30000}.get(period, 220)
        start = (today - timedelta(days=span)).strftime("%Y%m%d")
    return rest.daily_chart(symbol, start, end, market, period, adj)


@router.get("/chart/{symbol}/minute")
def get_minute_chart(
    symbol: str,
    market: str = "J",
    base_hour: str | None = Query(None, pattern="^[0-9]{6}$"),
    past: str = Query("Y", pattern="^[YN]$"),
) -> dict:
    base_hour = base_hour or datetime.now().strftime("%H%M%S")
    return rest.minute_chart(symbol, base_hour, market, past)


@router.get("/index")
def get_index() -> list[dict]:
    """국내 주요 지수(코스피/코스닥) 현재값."""
    return [x for x in (rest.market_index("kospi"), rest.market_index("kosdaq")) if x]
