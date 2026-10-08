"""Run official GitHub browser login without requesting passwords in chat."""
from pathlib import Path
import shutil
import subprocess

gh = shutil.which("gh")
cache = Path.home() / ".cache/campus-tree-tools/gh"
if not gh and cache.is_file():
    gh = str(cache)
if not gh:
    raise SystemExit("未安装 GitHub CLI，请先从 https://cli.github.com/ 安装。")
raise SystemExit(subprocess.call([gh, "auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web", "--scopes", "workflow"]))
