"""로컬 음성 안내 라우터 (macOS `say`).

체결/알림 시 프론트엔드가 `/api/say`를 호출해 맥 스피커로 음성 안내한다.
브라우저 오디오(WebAudio) unlock이 필요 없고, 백엔드가 도는 맥에서 직접 재생된다.
보안: 셸을 쓰지 않는 리스트 인자 실행 + 길이 제한으로 인젝션을 차단한다.
"""
from __future__ import annotations

import shutil
import subprocess

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["notify"])

_SAY = shutil.which("say")  # macOS 아니면 None → 무음(no-op)


class SayIn(BaseModel):
    text: str


@router.post("/say")
def say(body: SayIn) -> dict:
    text = body.text.strip()[:100]
    if text and _SAY:
        # 리스트 인자(셸 미사용)로 인젝션 차단. Popen fire-and-forget(비블로킹).
        subprocess.Popen([_SAY, text])  # noqa: S603
    return {"ok": bool(text and _SAY)}
