"""Record real direct-network checks after publication. No configured HTTP proxy."""
from pathlib import Path
import argparse
import datetime
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "script" and values.get("src"):
            self.paths.append(values["src"])
        if tag == "link" and values.get("rel") == "stylesheet" and values.get("href"):
            self.paths.append(values["href"])


def main():
    parser = argparse.ArgumentParser(description="关闭代理后检测真实发布网址，记录首页与点云下载时间")
    parser.add_argument("url", help="完整站点根网址，保留仓库子目录，如 https://alice.github.io/campus-tree-archive/")
    parser.add_argument("--network-label", default="未标注", help="如 校园宽带 / 家庭宽带 / 手机移动网络 / 本机验证")
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args()
    parsed = urllib.parse.urlsplit(args.url)
    if parsed.scheme not in ("https", "http") or not parsed.netloc:
        raise SystemExit("需要完整 http/https 网址")
    base = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/") + "/", "", ""))
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    records = []

    def fetch(label, relative):
        url = urllib.parse.urljoin(base, relative)
        started = time.perf_counter()
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "CampusTreeAccessCheck/1.0"})
            with opener.open(request, timeout=args.timeout) as response:
                body = response.read()
                result = {"label": label, "url": url, "status": response.status,
                          "seconds": round(time.perf_counter() - started, 3), "bytes": len(body), "ok": response.status == 200}
        except Exception as exc:
            body = b""
            result = {"label": label, "url": url, "seconds": round(time.perf_counter() - started, 3), "ok": False, "error": str(exc)}
        records.append(result)
        print(f"{'PASS' if result['ok'] else 'FAIL'} {label}: {result['seconds']}s / {result.get('bytes', 0):,} bytes", flush=True)
        return body

    html = fetch("首页", "")
    assets = Assets()
    assets.feed(html.decode("utf-8", errors="replace"))
    for item in assets.paths:
        fetch("页面脚本/样式", item)
    manifest = fetch("树木参数索引", "data/trees.json")
    try:
        payload = json.loads(manifest)
        trees = {t["id"]: t for t in payload["trees"]}
        for tree_id, quality in [("1-022", "high"), ("2-030", "lite")]:
            content = fetch(f"{tree_id} {quality} 点云", trees[tree_id]["models"][quality]["path"])
            if not content.startswith(b"ply\n"):
                records[-1]["ok"] = False
                records[-1]["error"] = "返回内容不是 PLY 点云"
        fetch("分享链接", "?tree=2-030")
    except (ValueError, KeyError, TypeError) as exc:
        records.append({"label": "参数内容校验", "ok": False, "error": str(exc)})
    now = datetime.datetime.now(datetime.timezone.utc)
    report = {"timeUTC": now.isoformat(), "networkLabel": args.network_label, "baseURL": base,
              "httpProxyDisabled": True, "allPassed": all(item["ok"] for item in records), "checks": records,
              "note": "这是 HTTP 可达性与下载时间；仍需浏览器验收三维交互。系统级 VPN 须自行关闭，单次网络结果不能代表所有国内网络。"}
    output = ROOT / "artifacts"
    output.mkdir(exist_ok=True)
    destination = output / f"access-check-{now.strftime('%Y%m%d-%H%M%S')}.json"
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"报告：{destination}")
    if not report["allPassed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
