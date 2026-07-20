"""로컬 WebSocket 브로드캐스트 허브.

KIS WS(별도 스레드) 수신분을 정규화한 메시지를 프론트엔드의 로컬 WS 구독자들에게 전달한다.
KIS WS 콜백은 다른 스레드에서 돌기 때문에, thread-safe 하게 asyncio 루프로 넘긴다.
"""
from __future__ import annotations

import asyncio
import math
from typing import Any

from fastapi import WebSocket


def _no_nan(o: Any) -> Any:
    """메시지 내 float NaN(주로 pandas 빈 필드)을 None으로 치환.

    NaN이 하나라도 있으면 send_json이 비표준 JSON(`NaN`)을 만들고 프론트의
    JSON.parse가 실패해 메시지 전체가 버려진다(예: 체결통보 종목명 nan → fill 유실).
    """
    if isinstance(o, float):
        return None if math.isnan(o) else o
    if isinstance(o, dict):
        return {k: _no_nan(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_no_nan(v) for v in o]
    return o


class Hub:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """앱 기동 시 메인 asyncio 루프를 등록(다른 스레드에서 publish 하기 위함)."""
        self._loop = loop

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self._clients.discard(ws)

    async def _broadcast(self, message: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        for ws in self._clients:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    def publish_threadsafe(self, message: dict[str, Any]) -> None:
        """KIS WS 콜백 스레드에서 호출. 메인 루프로 안전하게 넘긴다."""
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(self._broadcast(_no_nan(message)), self._loop)


hub = Hub()
