# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec — kis-hts 백엔드를 단일 실행 바이너리로 동결.

빌드(backend/ 에서):
  uv run pyinstaller packaging/kis-hts-backend.spec --noconfirm \
      --distpath packaging/dist --workpath packaging/build

결과: packaging/dist/kis-hts-backend  (onefile)

주의: open-trading-api(kis_auth 등)는 런타임에 sys.path로 로드되는 외부 소스라
번들에 넣지 않는다. 다만 그 코드가 쓰는 3rd-party(pandas/requests/websockets/yaml/
Crypto)는 여기서 함께 담겨야 프리즌 인터프리터가 import 할 수 있다.
"""
import os

from PyInstaller.utils.hooks import collect_all, collect_submodules

# 스펙은 backend/packaging/ 에 있고, 진입 스크립트/앱 패키지는 backend/ 에 있다.
BACKEND_DIR = os.path.abspath(os.path.join(SPECPATH, ".."))  # noqa: F821 (SPECPATH: PyInstaller 주입)

datas, binaries, hiddenimports = [], [], []

# 무겁거나 동적 로딩이 있어 정적 분석이 놓치기 쉬운 패키지는 통째로 수집
for pkg in ("pandas", "numpy", "uvicorn", "fastapi", "pydantic", "pydantic_settings",
            "starlette", "anyio", "yaml", "Crypto", "websockets", "requests", "certifi",
            "dotenv", "websocket"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

# uvicorn이 런타임에 문자열로 고르는 loop/protocol/lifespan 구현 (정적 분석 사각지대)
hiddenimports += [
    "uvicorn.loops.auto", "uvicorn.loops.asyncio", "uvicorn.loops.uvloop",
    "uvicorn.protocols.http.auto", "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.lifespan.on", "uvicorn.lifespan.off",
    "uvloop", "httptools", "h11",
]
# 우리 앱 서브모듈 전부(라우터/kis) — 대부분 정적으로 잡히지만 안전빵
hiddenimports += collect_submodules("app")

a = Analysis(
    [os.path.join(BACKEND_DIR, "run_server.py")],
    pathex=[BACKEND_DIR],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "IPython", "pytest"],
    noarchive=False,
)
pyz = PYZ(a.pure)

# onedir: 실행마다 압축 해제하는 onefile과 달리 폴더형이라 콜드 스타트가 훨씬 빠르다.
# 결과: packaging/dist/kis-hts-backend/  (내부에 kis-hts-backend 실행파일 + _internal/)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="kis-hts-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="kis-hts-backend",
)
