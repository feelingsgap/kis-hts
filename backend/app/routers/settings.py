"""설정 상태 라우터.

- GET  /api/settings/status          연결/계정 상세 상태(앱키 마스킹, 앱시크릿 값 미반환)
- POST /api/settings/token/refresh   토큰 강제 재발급 후 상태 반환
- POST /api/settings/credentials     자격증명 편집(config/{env}/.env 저장 + 재인증)

앱시크릿은 쓰기 전용: 저장은 하되 어떤 응답에도 값을 반환하지 않는다(설정 여부만).
자격증명 파일은 gitignore 대상이라 커밋되지 않는다.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import bootstrap_open_trading_api, get_settings, save_credentials
from app.kis.auth import token_manager

router = APIRouter(tags=["settings"])


def _status() -> dict:
    st = token_manager.settings_status()
    try:
        st["ota_path"] = str(bootstrap_open_trading_api())
    except Exception:  # noqa: BLE001
        st["ota_path"] = None
    return st


class CredentialsIn(BaseModel):
    app_key: str | None = None
    app_secret: str | None = None
    account: str | None = None
    hts_id: str | None = None
    prod: str | None = None


@router.get("/settings/status")
def get_status() -> dict:
    return _status()


@router.post("/settings/token/refresh")
def post_token_refresh() -> dict:
    try:
        token_manager.refresh_token()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"토큰 재발급 실패: {e}") from e
    return _status()


@router.post("/settings/credentials")
def post_credentials(body: CredentialsIn) -> dict:
    env = get_settings().env
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="변경할 항목이 없습니다.")
    save_credentials(env, updates)
    try:
        token_manager.apply_credentials()
    except Exception as e:  # noqa: BLE001 (저장은 완료, 재인증만 실패)
        raise HTTPException(
            status_code=502, detail=f"저장은 됐으나 재인증에 실패했습니다: {e}"
        ) from e
    return _status()
