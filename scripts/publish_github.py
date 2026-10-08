"""Publish this isolated project through the user's existing GitHub CLI login."""
from pathlib import Path
import argparse
import json
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
GH_CACHE = Path.home() / ".cache/campus-tree-tools/gh"
GH = shutil.which("gh") or (str(GH_CACHE) if GH_CACHE.is_file() else None)


def run(*args, capture=False, check=True):
    if args[0] == "gh" and GH:
        args = (GH, *args[1:])
    return subprocess.run(args, cwd=ROOT, text=True, capture_output=capture, check=check)


def main():
    parser = argparse.ArgumentParser(description="发布免费 GitHub Pages；先在本机执行 gh auth login")
    parser.add_argument("repository", help="你的 GitHub 用户名/仓库名，如 alice/campus-tree-archive")
    parser.add_argument("--create", action="store_true", help="目标仓库不存在时创建公开仓库")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+", args.repository):
        raise SystemExit("仓库格式必须是 用户名/仓库名")
    for command in ["git", "gh", "npm"]:
        if not (GH if command == "gh" else shutil.which(command)):
            raise SystemExit(f"未安装 {command}。请按 README.md 安装后重试。")
    if run("gh", "auth", "status", capture=True, check=False).returncode:
        raise SystemExit("请先在本机执行：gh auth login --hostname github.com --git-protocol https --web")
    identity = json.loads(run("gh", "api", "user", capture=True).stdout)
    owner = args.repository.split("/")[0]
    if owner.lower() != identity["login"].lower():
        raise SystemExit(f"本脚本只发布到当前登录账户 {identity['login']} 名下，避免误操作其他账户。")
    target = run("gh", "api", f"repos/{args.repository}", capture=True, check=False)
    exists = target.returncode == 0
    if exists:
        remote_info = json.loads(target.stdout)
        if remote_info["private"]:
            raise SystemExit("目标仓库是私有仓库。免费 GitHub Pages 需要公开仓库，本脚本不会更改仓库可见性。")
    elif not args.create:
        raise SystemExit("无法访问目标仓库。请检查仓库名称与权限；确认新建时加 --create。")
    # All reviewable assets and build checks complete before remote writes.
    run(sys.executable, "scripts/validate_data.py")
    run("npm", "run", "build")
    if not (ROOT / ".git").is_dir():
        if exists and json.loads(target.stdout).get("size", 0):
            raise SystemExit("目标仓库已有内容。请选一个空仓库，避免覆盖现有项目。")
        run("git", "init", "-b", "main")
    else:
        branch = run("git", "branch", "--show-current", capture=True).stdout.strip()
        if branch != "main":
            raise SystemExit("请切换到 main 分支后重试。脚本不会自动更改现有分支。")
    remote = run("git", "remote", "get-url", "origin", capture=True, check=False)
    expected_url = f"https://github.com/{args.repository}.git"
    if remote.returncode == 0 and remote.stdout.strip() not in [expected_url, expected_url[:-4], f"git@github.com:{args.repository}.git"]:
        raise SystemExit("本地 origin 指向其他仓库。请核实后手动调整，脚本不会替换它。")
    if run("git", "config", "--get", "user.name", capture=True, check=False).returncode:
        run("git", "config", "user.name", identity.get("name") or identity["login"])
    if run("git", "config", "--get", "user.email", capture=True, check=False).returncode:
        run("git", "config", "user.email", f"{identity['id']}+{identity['login']}@users.noreply.github.com")
    run("git", "add", ".")
    changes = run("git", "diff", "--cached", "--quiet", check=False)
    if changes.returncode == 1:
        run("git", "commit", "-m", "Build campus tree point-cloud archive")
    elif changes.returncode != 0:
        raise SystemExit("无法检查暂存区，发布已停止。")
    if not exists:
        run("gh", "repo", "create", args.repository, "--public", "--description", "校园树木三维点云与参数展示")
    if remote.returncode:
        run("git", "remote", "add", "origin", expected_url)
    # Use gh's credential helper for this command only, without modifying global Git configuration.
    import shlex
    run("git", "-c", "credential.helper=", "-c", f"credential.helper=!{shlex.quote(GH)} auth git-credential", "push", "-u", "origin", "main")
    pages = run("gh", "api", f"repos/{args.repository}/pages", capture=True, check=False)
    method = "PUT" if pages.returncode == 0 else "POST"
    run("gh", "api", "--method", method, f"repos/{args.repository}/pages", "-f", "build_type=workflow")
    run("gh", "workflow", "run", "deploy.yml", "--repo", args.repository)
    print(f"发布任务已启动：https://github.com/{args.repository}/actions")
    print(f"等待 Actions 成功后，网址：https://{owner}.github.io/{args.repository.split('/')[1]}/")
    print("公开站点仍需关闭代理后进行国内宽带和移动网络验收。")


if __name__ == "__main__":
    main()
