# 校园树木 · 三维档案

68 棵树的中文三维点云展示平台。纯静态网页，可免费部署到 GitHub Pages，也可本地运行或迁移到 Netlify / 学校已有空间。无外部 CDN、数据库、运行服务器和第三方字体依赖。

## 直接查看本地版

已构建时，在此项目目录运行：

```bash
python3 scripts/serve_local.py
```

浏览器打开 **http://localhost:4173/**。服务仅绑定本机地址，按 Ctrl+C 停止。不要直接双击 `dist/index.html`，浏览器的文件读取限制会阻止加载参数和点云。

`artifacts/campus-tree-offline.zip` 是完整离线演示包。解压后需要 Python 3，不需要 Node.js 或联网。Windows 可双击包内 `启动网站.bat`；macOS / Linux 按包内说明启动。服务器不是付费服务，而是临时在本机读取网页文件。

## 功能

- 目录搜索，组别、树高、胸径可信结果筛选；手机可横向浏览树木缩略图。
- 点云旋转、缩放、平移、恢复视角、自动旋转、全屏和分享链接。
- 原始 RGB / 高度着色，轻量 / 清晰两档点云，点大小调整。
- 参数表排序、可信胸径统计和筛选结果 CSV 下载。CSV 保留胸径的米单位，界面转为厘米。
- 两组分别展示扫描位置分布，支持点击和键盘选择。
- 无 WebGL、网络失败或点云加载失败时保留真实点云图片和参数；加载失败可重试。

## 数据来源与差异

唯一权威参数来源是原工作空间上一级 Downloads 中的 **All_Tree_Params.csv**。已复制到 `public/data/All_Tree_Params.csv`，SHA-256：

```text
6f75b3804cb1e33792a48d1699a0519fcdd7aebd7b03089d242e75de7a6ac420
```

旧参数表与权威表均有 68 行。共有字段中有 **67 棵树的 DBH_Avg(m) 不同**；新版新增 `DBH_Reliable`，26 棵为可信，42 棵不可信且胸径为空。空值保存为 null，不补旧值、不当作零。差异与数据统计可查看 `public/data/validation-report.json`。

编号映射表提供来源索引，不是测量参数表；原本地盘符和路径不会出现在公开界面中。原始 PLY、旧参数表和映射表均未修改。

三维展示文件只包含 XYZ 与 RGB，每棵最多 50,000 / 200,000 点。保留原始坐标极值，平移到局部原点，Z 轴保持向上；平移量记录在 `trees.json` 中。精简点云用于展示，不用于科研测量。X/Y 缺少地理坐标系，不能当经纬度使用。资产约 **180.2 MiB**，包含 68 张真实点云缩略图和 136 个模型，原始约 631 MiB 点云不上传。

## 开发与验证

需要 Node.js 24 和 Python 3.10 以上。发布时仅需已经生成的数据，CI 不读取 Downloads 或原始点云。

```bash
npm ci
npm run dev
npm run data:validate
npm run build
```

浏览器测试包含桌面和手机布局、真实点云颜色、大小极值、两组格式、筛选、胸径空值、CSV 单位、排序、位置图、请求失败回退和无 WebGL 回退：

```bash
npx playwright install chromium
npm test
```

截图输出到 `artifacts/`，失败时的 trace 位于 `test-results/`。首次在 Linux 安装 Playwright 若提示缺少系统依赖，按官方安装说明补齐浏览器依赖。

## 更新树木数据

保留完整权威参数 CSV（含 `DBH_Reliable`）。编号需与 PLY 文件名一一对应。生成器解析每个 PLY 的文件头，不假定两组具有相同属性布局：

```bash
python3 -m pip install -r scripts/requirements.txt
python3 scripts/prepare_data.py --input-dir /你的点云目录 --params /你的权威参数.csv
npm run data:validate
npm run build
npm run package:offline
```

默认输入目录为项目上一级，默认参数文件为项目上两级的 `All_Tree_Params.csv`。生成器不会改写输入。当前数据验证器锁定这次交付的 68 棵、33/35 分组和 26/42 胸径情况；以后增减树木或更新可信结果时需同步更新这些验收基准，避免将数据变更误认为数据损坏。

模型重生成会覆盖 `public/models` 和缩略图中的同名展示文件。增减编号前先备份项目，再清理已经移除编号的旧展示资产；生成后执行全量校验。

## 发布到 GitHub Pages（免费）

**发布管理需要你登录自己的 GitHub；公开网站访客无需登录。**免费账号使用公开仓库和 `github.io` 地址，不购买域名，不上传原始点云。不需要把密码或令牌给任何人。

### 方式一：使用发布脚本

1. 安装 Git 与官方 GitHub CLI（[cli.github.com](https://cli.github.com/)）。
2. 在本机终端完成登录授权，选择 HTTPS 和浏览器登录：

   ```bash
   gh auth login --hostname github.com --git-protocol https --web --scopes workflow
   ```

   当前机器若已由本项目准备 GitHub CLI，也可执行 `python3 scripts/github_login.py`。登录信息由官方 CLI 保存在本机，不进入项目或发布包。

3. 将下面的 `你的用户名` 替换为当前登录的 GitHub 用户名。新仓库名称默认建议 `campus-tree-archive`：

   ```bash
   python3 scripts/publish_github.py 你的用户名/campus-tree-archive --create
   ```

脚本先校验并构建，再创建公开仓库、提交项目、推送 main、设置 Pages 使用 GitHub Actions 并启动发布。使用现有空公开仓库时去掉 `--create`。不覆盖已有仓库内容，不强制推送，不替换其他 origin，不把私有仓库改成公开；首次本地提交使用当前登录用户的 GitHub noreply 邮箱。若现有仓库已有其他历史，普通推送可能拒绝，请使用新建的空仓库。

等仓库的 **Actions → Publish tree archive to GitHub Pages** 显示成功后查看：

```text
https://你的用户名.github.io/campus-tree-archive/
```

### 方式二：手动发布

1. 登录 GitHub，新建空的 Public 仓库，仓库名建议 `campus-tree-archive`。
2. 将本项目目录作为仓库根目录，包含 `.github/workflows/deploy.yml`、源码、package-lock 和 `public/`；不要上传 node_modules、artifacts、dist 或原始点云。
3. 在项目目录执行 Git 初始化、提交并推送。用 GitHub CLI 在本机授权，或使用自己已经配置的 Git 登录方式：

   ```bash
   git init -b main
   git add .
   git commit -m "Build campus tree point-cloud archive"
   git remote add origin https://github.com/你的用户名/campus-tree-archive.git
   git push -u origin main
   ```

4. 仓库 **Settings → Pages → Source** 选择 **GitHub Actions**。
5. 在 **Actions** 手动运行发布工作流（Run workflow）。之后推送 main 会自动更新。

GitHub 网页上传有单文件和批量数量限制，180 MiB 项目不建议逐批拖拽；优先 Git 推送。网页上传一个 ZIP 不会自动解压成网站。

## 免费备选与国内直连验收

GitHub Pages 的静态网站上限 1 GB、月流量软限制 100 GB；本项目容量足够，但不能保证所有国内网络稳定直连。[官方限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

发布后，关闭代理，分别用校园/家庭宽带和手机移动网络打开真实网址，检查首页、搜索、1-022 清晰点云、2-030 轻量点云和分享链接；记录首屏与点云加载时长、是否失败。登录管理端的访问情况与访客网址分别记录。

可在连接相应网络后运行下列工具，它会跳过环境中的 HTTP 代理，记录网页、脚本、参数和代表点云的下载结果。系统级 VPN 仍需要你自行关闭：

```bash
python3 scripts/check_access.py https://你的用户名.github.io/campus-tree-archive/ --network-label 校园宽带
```

报告输出到 `artifacts/access-check-时间.json`，单次测试不能代表全部国内网络，也不能替代浏览器里的三维交互验收。

若 GitHub 不合格，登录 Netlify Free，把 **dist 文件夹**拖到手动部署界面，或导入仓库（已有 netlify.toml）。保持 Free 套餐，不启用付费项。默认 netlify.app 地址无需购买域名。它的国内可用性也需同样实测。

Netlify 新账号目前每月 300 积分，生产发布消耗 15 积分、流量每 GB 消耗 20 积分，请求也占额度。用尽可能暂停站点，不能把旧版 100 GB 免费流量当作当前套餐。[官方套餐](https://www.netlify.com/pricing/)、[积分说明](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)

EdgeOne 默认域名在国内有 401 或临时预览链接限制；没有自有域名时不作为稳定零成本交付方案。[官方说明](https://edgeone.cloud.tencent.com/pages/document/175191784523485184)

两个免费平台均不合格时保留本地演示版，等待学校免费空间；不以“需要梯子才能查看”作为上线验收通过。
