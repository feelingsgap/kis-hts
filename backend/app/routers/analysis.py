"""순위분석 + 투자자 매매동향 라우터.

- GET /api/ranking/volume            거래량 순위
- GET /api/ranking/fluctuation?type=  등락률 순위 (up/down)
- GET /api/investor/{symbol}          외국인/기관/개인 순매수
"""
from __future__ import annotations

from fastapi import APIRouter, Query

from app.kis import analysis

router = APIRouter(tags=["analysis"])


@router.get("/ranking/volume")
def ranking_volume() -> list[dict]:
    return analysis.ranking_volume()


@router.get("/ranking/fluctuation")
def ranking_fluctuation(type: str = Query("up", pattern="^(up|down)$")) -> list[dict]:
    return analysis.ranking_fluctuation(type)


@router.get("/investor/{symbol}")
def investor(symbol: str, market: str = "J") -> dict:
    return analysis.investor(symbol, market)
