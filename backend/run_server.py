"""동결(PyInstaller)용 백엔드 진입점.

`uvicorn app.main:app` CLI 대신 uvicorn을 프로그램적으로 기동한다. Tauri 셸이
이 바이너리를 자식 프로세스로 스폰하며, 환경변수로 env/포트/repo 루트를 넘긴다:
  KIS_HTS_ENV        vps(모의) | prod(실전)
  KIS_HTS_PORT       포트 (기본 8787)
  KIS_HTS_REPO_ROOT  자격증명 config/{env}/.env 를 찾을 repo 루트

소스에서 직접 실행도 가능: `uv run python run_server.py`.
"""
from __future__ import annotations

import os

import uvicorn

from app.main import app


def main() -> None:
    port = int(os.environ.get("KIS_HTS_PORT", "8787"))
    host = os.environ.get("KIS_HTS_HOST", "127.0.0.1")
    # app 객체를 직접 넘김(reload 불가 — 동결 환경에선 불필요).
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
