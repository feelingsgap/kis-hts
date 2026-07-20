"""로컬 음성 안내 라우터 (macOS `say`).

체결/접수/알림 시 프론트엔드가 `/api/say`를 호출해 맥 스피커로 음성 안내한다.
브라우저 오디오(WebAudio) unlock이 필요 없고, 백엔드가 도는 맥에서 직접 재생된다.
여러 요청이 몰려도(예: 시장가 주문의 접수→체결이 연달아 옴) 겹쳐 들리지 않도록
데몬 워커 스레드에서 큐로 **순차 재생**한다.
보안: 셸을 쓰지 않는 리스트 인자 실행 + 길이 제한으로 인젝션을 차단한다.
"""
from __future__ import annotations

import queue
import shutil
import subprocess
import threading

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["notify"])

_SAY = shutil.which("say")  # macOS 아니면 None → 무음(no-op)
_QUEUE: "queue.Queue[str]" = queue.Queue(maxsize=32)


def _worker() -> None:
    while True:
        text = _QUEUE.get()
        try:
            subprocess.run([_SAY, text], check=False)  # noqa: S603  블로킹 → 순차 재생(겹침 방지)
        except Exception:  # noqa: BLE001
            pass


if _SAY:
    threading.Thread(target=_worker, name="say-worker", daemon=True).start()


class SayIn(BaseModel):
    text: str


@router.post("/say")
def say(body: SayIn) -> dict:
    text = body.text.strip()[:100]
    if text and _SAY:
        try:
            _QUEUE.put_nowait(text)  # 큐가 꽉 차면(밀린 음성 과다) 조용히 버림
        except queue.Full:
            pass
    return {"ok": bool(text and _SAY)}
