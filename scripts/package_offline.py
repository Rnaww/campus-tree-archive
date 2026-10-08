from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
PREFIX = "校园树木三维档案"


def main():
    if not (DIST / "index.html").exists():
        raise SystemExit("Run npm run build first")
    output = ROOT / "artifacts"
    output.mkdir(exist_ok=True)
    path = output / "campus-tree-offline.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for item in sorted(DIST.rglob("*")):
            if item.is_file():
                archive.write(item, f"{PREFIX}/site/{item.relative_to(DIST).as_posix()}")
        archive.write(ROOT / "scripts/serve_local.py", f"{PREFIX}/scripts/serve_local.py")
        archive.writestr(f"{PREFIX}/启动网站.command", '#!/bin/sh\ncd "$(dirname "$0")"\npython3 scripts/serve_local.py\n')
        archive.writestr(f"{PREFIX}/启动网站.sh", '#!/bin/sh\ncd "$(dirname "$0")"\npython3 scripts/serve_local.py\n')
        archive.writestr(f"{PREFIX}/启动网站.bat", '@echo off\r\ncd /d "%~dp0"\r\nwhere py >nul 2>nul\r\nif %errorlevel% equ 0 (py -3 scripts\\serve_local.py) else (python scripts\\serve_local.py)\r\npause\r\n')
        archive.writestr(f"{PREFIX}/使用说明.txt", "校园树木三维档案 · 本地演示版\n\n1. 解压整个压缩包，保持文件夹结构。\n2. 需要 Python 3；不需要 Node.js、npm、账号或网络连接。\n3. Windows：双击 启动网站.bat。\n   macOS/Linux：在本文件夹终端执行 python3 scripts/serve_local.py。\n4. 浏览器打开 http://localhost:4173/ 。\n5. 关闭终端或按 Ctrl+C 停止服务。\n\n不能直接双击 site/index.html，浏览器会阻止点云与参数读取。\n如果端口被占用，执行 python3 scripts/serve_local.py --port 4174。\n展示文件为精简点云，原始科研文件仍保留在原工作空间。\n")
    print(f"Offline package: {path} ({path.stat().st_size / 2**20:.1f} MiB)")


if __name__ == "__main__":
    main()
