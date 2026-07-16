"""주문 라우터 (P3).

- POST /api/order          현금 매수/매도 (order_cash)
- POST /api/order/revise   정정 (order_rvsecncl, 01)
- POST /api/order/cancel   취소 (order_rvsecncl, 02)
- GET  /api/orders/pending 미체결(정정취소가능) 조회

주의: 모의투자 시 TR_ID 자동 스왑(T→V). 주문은 postFlag=True.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.kis import rest

router = APIRouter(tags=["orders"])


class OrderReq(BaseModel):
    side: str = Field(pattern="^(buy|sell)$")
    symbol: str
    qty: int = Field(gt=0)
    price: int = Field(ge=0)          # 시장가(01)는 0
    ord_dvsn: str = Field("00", pattern="^(00|01)$")  # 00 지정가 / 01 시장가


class ReviseReq(BaseModel):
    org_no: str
    order_no: str
    qty: int = Field(gt=0)
    price: int = Field(ge=0)
    ord_dvsn: str = Field("00", pattern="^(00|01)$")


class CancelReq(BaseModel):
    org_no: str
    order_no: str
    qty: int = Field(0, ge=0)         # 0이면 전량취소


@router.post("/order")
def post_order(req: OrderReq) -> dict:
    res = rest.place_order(req.side, req.symbol, req.qty, req.price, req.ord_dvsn)
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "주문 실패"))
    return res


@router.post("/order/revise")
def post_revise(req: ReviseReq) -> dict:
    res = rest.revise_cancel(
        req.org_no, req.order_no, "01", req.qty, req.price, req.ord_dvsn, qty_all="N"
    )
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "정정 실패"))
    return res


@router.post("/order/cancel")
def post_cancel(req: CancelReq) -> dict:
    qty_all = "Y" if req.qty == 0 else "N"
    res = rest.revise_cancel(
        req.org_no, req.order_no, "02", req.qty, 0, "00", qty_all=qty_all
    )
    if not res.get("ok"):
        raise HTTPException(status_code=400, detail=res.get("error", "취소 실패"))
    return res


@router.get("/orders/pending")
def get_pending() -> list[dict]:
    return rest.pending_orders()


@router.get("/orders/filled")
def get_filled() -> list[dict]:
    return rest.filled_orders()
