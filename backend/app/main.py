"""FastAPI 로컬 sidecar 백엔드.

기동:
  cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8787

P1 범위:
  - /health, /api/auth/status
  - 시세/호가/차트 REST (routers/quotes.py)
  - 로컬 WS(/ws) + KIS WS 릴레이(체결/호가)
"""
from __future__ import annotations

import asyncio
import contextlib
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app import store
from app.config import get_settings
from app.kis.auth import token_manager
from app.kis.ws import ws_manager
from app.realtime import hub
from app.routers import account, analysis, orders, quotes, symbols

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
settings = get_settings()

app = FastAPI(title="KIS HTS Backend", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "http://127.0.0.1:1420", "tauri://localhost"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(quotes.router, prefix="/api")
app.include_router(account.router, prefix="/api")
app.include_router(orders.router, prefix="/api")
app.include_router(symbols.router, prefix="/api")
app.include_router(analysis.router, prefix="/api")


@app.on_event("startup")
async def _startup() -> None:
    hub.bind_loop(asyncio.get_running_loop())
    # REST 토큰 확보(파일 캐시 재사용). 자격증명 미설정 시 조용히 건너뜀.
    with contextlib.suppress(Exception):
        token_manager.ensure_rest()
    # KIS WS 릴레이 기동(별도 스레드). 관심종목은 SQLite에서 로드. 장 시간 외엔 구독만.
    with contextlib.suppress(Exception):
        ws_manager.start(store.get_watchlist())


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "env": settings.env, "svr": settings.svr}


@app.get("/api/auth/status")
async def auth_status() -> dict:
    return token_manager.status()


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    """프론트엔드 실시간 구독 채널. 서버→클라 브로드캐스트(체결/호가)."""
    await hub.connect(ws)
    try:
        while True:
            await ws.receive_text()  # 클라 제어 메시지는 P2에서 처리
    except WebSocketDisconnect:
        hub.disconnect(ws)


