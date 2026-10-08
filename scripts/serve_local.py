"""Serve the built site on localhost, including requests with Chinese paths."""
from pathlib import Path
import argparse
import functools
import http.server
import socketserver
import threading
import webbrowser


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    site = root / "site"
    if not site.is_dir():
        site = root / "dist"
    if not (site / "index.html").exists():
        raise SystemExit("未找到构建后的网页。请先执行 npm run build，或使用完整本地演示包。")
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(site))
    socketserver.TCPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        url = f"http://localhost:{args.port}/"
        print(f"校园树木三维档案：{url}\n按 Ctrl+C 停止。仅本机可访问。", flush=True)
        if not args.no_browser:
            threading.Timer(.6, lambda: webbrowser.open(url)).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
