import './style.css';
import { assetUrl, escapeHtml as esc, exportCsv, filterTrees, format, pointCount, sortTrees } from './data';
import type { SortKey } from './data';
import type { Dataset, Filters, Quality, Tree, View } from './types';
import { TreeViewer } from './viewer';

const paths: Record<string, string> = {
  leaf: '<path d="M20 4C10 2 3 6 4 13c1 6 8 7 12 3 3-3 4-7 4-12Z"/><path d="m4 21 12-12M9 16v-5m3 2h5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  cube: '<path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 9 9-4M12 12 3 8m9 4v10"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M10 4v16"/>',
  map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16"/>',
  down: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  reset: '<path d="M4 9a8 8 0 1 1 0 6M4 3v6h6"/>',
  rotate: '<path d="M4 10c0-4 3-7 8-7 4 0 8 3 8 7M20 14c0 4-3 7-8 7-4 0-8-3-8-7M20 4v6h-6M4 20v-6h6"/>',
  share: '<path d="M14 4h6v6m0-6-9 9M10 5H4v15h15v-6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  expand: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
};
const icon = (name: string, cls = '') => `<svg class="icon ${cls}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? paths.leaf}</svg>`;
const app = document.querySelector<HTMLDivElement>('#app')!;
const query = new URLSearchParams(window.location.search);
const allowedViews: View[] = ['browse', 'table', 'map'];
let view: View = allowedViews.includes(query.get('view') as View) ? query.get('view') as View : 'browse';
let dataset: Dataset;
let selected: Tree;
let viewer: TreeViewer | null = null;
let quality: Quality = window.matchMedia('(max-width: 760px)').matches ? 'lite' : 'high';
let colorMode = 'rgb';
let rotating = false;
let pointSize = 2;
let mapGroup = '1';
let sortKey: SortKey = 'id';
let ascending = true;
const filters: Filters = { query: '', group: 'all', height: 'all', reliability: 'all' };

function currentTrees(): Tree[] { return filterTrees(dataset.trees, filters); }

function updateUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('tree', selected.id);
  if (view === 'browse') url.searchParams.delete('view');
  else url.searchParams.set('view', view);
  history.replaceState(null, '', url);
  document.title = `${selected.id} · 校园树木三维档案`;
}

function toast(message: string) {
  const host = document.getElementById('toast')!;
  host.textContent = message;
  host.classList.add('visible');
  window.setTimeout(() => host.classList.remove('visible'), 2800);
}

function renderShell() {
  const avgHeight = dataset.trees.reduce((sum, t) => sum + t.height, 0) / dataset.trees.length;
  const totalPoints = dataset.trees.reduce((sum, t) => sum + t.points, 0);
  const reliable = dataset.trees.filter((t) => t.dbhReliable).length;
  app.innerHTML = `
    <header class="site-header">
      <a class="brand" href="${import.meta.env.BASE_URL}" aria-label="校园树木档案首页"><span class="brand-mark">${icon('leaf')}</span><span>校园树木<span class="brand-subtitle">三维档案 · TREE ARCHIVE</span></span></a>
      <nav class="top-nav" aria-label="主导航">
        <button data-view="browse">${icon('cube')}三维浏览</button><button data-view="table">${icon('table')}参数总览</button><button data-view="map">${icon('map')}位置分布</button>
      </nav>
      <button class="button header-export" id="export-top">${icon('down')}导出参数</button>
    </header>
    <main class="site-main">
      <div class="page-intro"><div><span class="eyebrow">校园树木 / 点云档案</span><h1>从每一个点，认识一棵树<span class="title-dot">.</span></h1><p>浏览单木三维扫描，查看树木形态与测量参数。</p></div><span class="collection-date"><span class="live-dot"></span>68 棵树 · 2 组扫描</span></div>
      <section class="stats-strip" aria-label="数据概况">
        <div><span class="stat-caption">收录树木</span><strong>${dataset.trees.length}<small>棵</small></strong><span class="stat-note">第 1 组 33 棵 / 第 2 组 35 棵</span></div>
        <div><span class="stat-caption">平均树高</span><strong>${format(avgHeight)}<small>m</small></strong><span class="stat-note">按权威参数表计算</span></div>
        <div><span class="stat-caption">可信胸径</span><strong>${reliable}<small>棵</small></strong><span class="stat-note">${dataset.trees.length - reliable} 棵暂无可靠结果</span></div>
        <div><span class="stat-caption">原始扫描点</span><strong>${format(totalPoints / 10_000, 1)}<small>万</small></strong><span class="stat-note">彩色三维点云</span></div>
      </section>
      <div class="workspace">
        <aside class="directory-panel" aria-label="树木目录与筛选">
          <div class="panel-heading"><h2>树木目录</h2><span class="count-badge" id="filter-count">68</span></div>
          <label class="search-field">${icon('search')}<input id="search" type="search" placeholder="搜索树木编号，如 1-022" aria-label="搜索树木编号" autocomplete="off" /></label>
          <div class="group-filter" role="group" aria-label="扫描组别"><button class="active" data-group="all" aria-pressed="true">全部</button><button data-group="1" aria-pressed="false">第 1 组</button><button data-group="2" aria-pressed="false">第 2 组</button></div>
          <div class="filter-selects"><label><span>树高范围</span><select id="height-filter"><option value="all">全部树高</option><option value="under10">小于 10 m</option><option value="10to15">10–15 m</option><option value="15to20">15–20 m</option><option value="over20">20 m 及以上</option></select></label><label><span>胸径结果</span><select id="reliability-filter"><option value="all">全部结果</option><option value="reliable">可信胸径</option><option value="missing">暂无可靠胸径</option></select></label></div>
          <div class="directory-meta"><span id="directory-summary">全部 68 棵</span><button id="clear-filters" class="text-button">重置筛选</button></div>
          <div class="directory-list" id="directory-list"></div>
          <div class="directory-foot">${icon('leaf')}所有预览均来自真实扫描点云</div>
        </aside>
        <section class="content-panel" id="content" aria-label="树木展示"></section>
      </div>
      <footer class="site-footer"><span>校园树木 · 三维档案</span><span>参数来源：All_Tree_Params.csv <span class="footer-separator">/</span> 精简点云仅用于展示</span><button class="text-button" id="about-data">数据说明</button></footer>
    </main>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
    <dialog id="data-dialog"><button class="dialog-close icon-button" aria-label="关闭数据说明">${icon('close')}</button><span class="eyebrow">ABOUT THE DATA</span><h2>关于这批树木数据</h2><p>共 68 棵树，包含两组彩色单木点云。网页参数以 Downloads 下的 All_Tree_Params.csv 为准。</p><p>胸径仅展示标记为可信的结果，42 棵暂无可靠胸径，不使用旧表补值，也不将空值作为零参与统计。</p><p>三维点云经过空间抽样，原始点数与展示点数分别标示；展示点云不用于重新测量或替代原始科研数据。</p><p>X/Y 为扫描坐标，尚未提供地理坐标系，两组位置分别展示。</p><details><summary>参数来源校验</summary><p class="source-hash">SHA-256<br>${esc(dataset.source.sha256)}</p></details><a class="button" href="${assetUrl('data/All_Tree_Params.csv')}" download>${icon('down')}下载权威参数原表</a></dialog>
  `;
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => button.addEventListener('click', () => {
    view = button.dataset.view as View;
    mapGroup = selected.group;
    renderContent();
    updateUrl();
  }));
  document.getElementById('search')!.addEventListener('input', (event) => { filters.query = (event.target as HTMLInputElement).value; refreshFilters(); });
  document.querySelectorAll<HTMLButtonElement>('[data-group]').forEach((button) => button.addEventListener('click', () => {
    filters.group = button.dataset.group!;
    if (filters.group !== 'all') mapGroup = filters.group;
    document.querySelectorAll<HTMLButtonElement>('[data-group]').forEach((b) => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
    refreshFilters();
  }));
  document.getElementById('height-filter')!.addEventListener('change', (e) => { filters.height = (e.target as HTMLSelectElement).value; refreshFilters(); });
  document.getElementById('reliability-filter')!.addEventListener('change', (e) => { filters.reliability = (e.target as HTMLSelectElement).value; refreshFilters(); });
  document.getElementById('clear-filters')!.addEventListener('click', clearFilters);
  document.getElementById('export-top')!.addEventListener('click', downloadCsv);
  document.getElementById('directory-list')!.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-tree]');
    if (button) selectTree(button.dataset.tree!);
  });
  const dialog = document.getElementById('data-dialog') as HTMLDialogElement;
  document.getElementById('about-data')!.addEventListener('click', () => dialog.showModal());
  dialog.querySelector('button')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) { const rect = dialog.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) dialog.close(); } });
  renderDirectory();
  renderContent();
}

function clearFilters() {
  Object.assign(filters, { query: '', group: 'all', height: 'all', reliability: 'all' });
  (document.getElementById('search') as HTMLInputElement).value = '';
  (document.getElementById('height-filter') as HTMLSelectElement).value = 'all';
  (document.getElementById('reliability-filter') as HTMLSelectElement).value = 'all';
  document.querySelectorAll<HTMLButtonElement>('[data-group]').forEach((b) => { const active = b.dataset.group === 'all'; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); });
  refreshFilters();
}

function refreshFilters() {
  renderDirectory();
  if (view !== 'browse') renderContent();
  else updateSelectionNotice();
}

function renderDirectory() {
  const trees = currentTrees();
  document.getElementById('filter-count')!.textContent = String(trees.length);
  document.getElementById('directory-summary')!.textContent = `显示 ${trees.length} / ${dataset.trees.length} 棵`;
  document.getElementById('directory-list')!.innerHTML = trees.length ? trees.map((t) => `
    <button class="tree-row ${t.id === selected.id ? 'selected' : ''}" data-tree="${esc(t.id)}" aria-label="查看树木 ${esc(t.id)}" ${t.id === selected.id ? 'aria-current="true"' : ''}>
      <img src="${assetUrl(t.thumbnail)}" alt="" width="64" height="62" loading="lazy" /><span class="tree-row-info"><strong>${esc(t.id)}</strong><span>树高 ${format(t.height)} m<span class="row-dot">·</span>第 ${esc(t.group)} 组</span></span><span class="tree-row-arrow">${icon('arrow')}</span>
    </button>`).join('') : '<div class="empty-directory">没有匹配的树木<br><small>试试其他编号或重置筛选。</small></div>';
}

function selectTree(id: string, openBrowse = false) {
  const tree = dataset.trees.find((t) => t.id === id);
  if (!tree) return;
  selected = tree;
  if (openBrowse) view = 'browse';
  mapGroup = selected.group;
  renderDirectory();
  if (view === 'browse' && viewer) {
    document.getElementById('tree-title')!.textContent = selected.id;
    document.getElementById('tree-subtitle')!.textContent = `第 ${selected.group} 组 / 单木彩色点云`;
    document.getElementById('details')!.innerHTML = detailMarkup();
    updateSelectionNotice();
    void viewer.load(selected, quality);
  } else renderContent();
  updateUrl();
}

function detailMarkup(): string {
  const dbh = selected.dbh === null ? '<span class="missing-value">暂无可靠结果</span>' : `${format(selected.dbh * 100, 1)}<small>cm</small>`;
  return `<div class="detail-heading"><span class="eyebrow">TREE PROFILE</span><h2>树木参数</h2><span class="profile-id">${esc(selected.id)}</span></div>
    <div class="height-metric"><span>树高</span><strong>${format(selected.height)}<small>m</small></strong><div class="height-rule"><i style="width:${Math.min(100, selected.height / 30 * 100)}%"></i></div><span class="height-scale">0<span>30 m</span></span></div>
    <dl class="parameter-grid"><div><dt>冠幅宽度</dt><dd>${format(selected.crownWidth)}<small>m</small></dd></div><div><dt>冠幅长度</dt><dd>${format(selected.crownLength)}<small>m</small></dd></div><div class="dbh-metric"><dt>平均胸径</dt><dd>${dbh}</dd><span class="reliability ${selected.dbhReliable ? 'reliable' : 'unreliable'}">${selected.dbhReliable ? icon('check') + '可信结果' : '暂不提供胸径'}</span></div><div><dt>树干顶部高度</dt><dd>${format(selected.trunkTopHeight)}<small>m</small></dd></div></dl>
    <div class="scan-metadata"><h3>扫描记录</h3><dl><div><dt>原始点数</dt><dd>${pointCount(selected.points)}</dd></div><div><dt>扫描组别</dt><dd>第 ${esc(selected.group)} 组</dd></div><div><dt>位置 X</dt><dd>${format(selected.x)}</dd></div><div><dt>位置 Y</dt><dd>${format(selected.y)}</dd></div></dl><p>位置为扫描坐标，未提供地理坐标系。</p></div>
    ${view === 'map' ? `<button class="button primary full-width" data-action="open-browse">${icon('cube')}查看三维点云${icon('arrow')}</button>` : ''}
    <div class="parameter-note">${icon('check')}参数采用权威表，未用旧表补值。</div>`;
}

function renderContent() {
  viewer?.dispose();
  viewer = null;
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  const content = document.getElementById('content')!;
  content.className = `content-panel ${view}-content`;
  if (view === 'browse') {
    content.innerHTML = `<div class="viewer-panel"><div class="viewer-heading"><div><span class="eyebrow">单木三维</span><h2 id="tree-title">${esc(selected.id)}</h2><p id="tree-subtitle">第 ${esc(selected.group)} 组 / 单木彩色点云</p></div><div class="heading-actions"><button class="icon-button" data-action="share" aria-label="复制这棵树的分享链接" title="分享这棵树">${icon('share')}</button><button class="icon-button" data-action="fullscreen" aria-label="全屏查看三维点云" title="全屏查看">${icon('expand')}</button></div></div>
      <div class="viewer-toolbar"><div class="segmented" role="group" aria-label="点云着色"><button data-color="rgb" class="${colorMode === 'rgb' ? 'active' : ''}" aria-pressed="${colorMode === 'rgb'}">原始颜色</button><button data-color="height" class="${colorMode === 'height' ? 'active' : ''}" aria-pressed="${colorMode === 'height'}">高度着色</button></div><label class="quality-select">清晰度 <select id="quality"><option value="lite" ${quality === 'lite' ? 'selected' : ''}>轻量</option><option value="high" ${quality === 'high' ? 'selected' : ''}>清晰</option></select></label></div>
      <div id="viewer" class="viewer-canvas"></div>
      <div class="viewer-bottom"><label class="point-size-label">点大小<input id="point-size" type="range" min="1" max="5" step="0.5" value="${pointSize}" aria-label="点大小" /></label><div class="viewer-bottom-actions"><button class="text-button ${rotating ? 'active' : ''}" data-action="rotate" aria-pressed="${rotating}">${icon('rotate')}自动旋转</button><button class="text-button" data-action="reset-view">${icon('reset')}恢复视角</button></div></div>
      <p class="selection-notice" id="selection-notice" hidden></p><div class="viewer-note"><span class="note-number">01—68</span><p>展示点云经过空间抽样，树木参数保留原表测量值。</p></div>
    </div><aside class="details-panel" id="details" aria-label="当前树木参数">${detailMarkup()}</aside>`;
    viewer = new TreeViewer(document.getElementById('viewer')!);
    viewer.setColorMode(colorMode);
    viewer.setSize(pointSize);
    viewer.setRotating(rotating);
    void viewer.load(selected, quality);
    document.getElementById('quality')!.addEventListener('change', (event) => { quality = (event.target as HTMLSelectElement).value as Quality; void viewer?.load(selected, quality); });
    document.getElementById('point-size')!.addEventListener('input', (event) => { pointSize = Number((event.target as HTMLInputElement).value); viewer?.setSize(pointSize); });
    content.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((button) => button.addEventListener('click', () => {
      colorMode = button.dataset.color!;
      viewer?.setColorMode(colorMode);
      content.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
    }));
    updateSelectionNotice();
  } else if (view === 'table') renderTable(content);
  else renderMap(content);
  bindContentEvents(content);
}

function updateSelectionNotice() {
  const notice = document.getElementById('selection-notice');
  if (!notice) return;
  const outside = !currentTrees().some((t) => t.id === selected.id);
  notice.hidden = !outside;
  notice.textContent = outside ? '当前树木不在筛选结果中。可在目录选择其他树木，或重置筛选。' : '';
}

function renderTable(content: HTMLElement) {
  const trees = sortTrees(currentTrees(), sortKey, ascending);
  const reliable = trees.filter((t) => t.dbh !== null && t.dbhReliable);
  const average = reliable.length ? reliable.reduce((sum, t) => sum + t.dbh! * 100, 0) / reliable.length : null;
  const columns: [SortKey, string][] = [['id', '编号'], ['height', '树高 / m'], ['crownWidth', '冠幅宽 / m'], ['crownLength', '冠幅长 / m'], ['dbh', '胸径 / cm'], ['points', '原始点数']];
  content.innerHTML = `<div class="data-view-header"><div><span class="eyebrow">TREE PARAMETERS</span><h2>参数总览</h2><p>${trees.length} 棵筛选结果 · 点击编号查看三维</p></div><button class="button" data-action="export">${icon('down')}下载筛选结果</button></div><div class="table-summary"><span>可信胸径 <strong>${reliable.length} 棵</strong></span><span>平均可信胸径 <strong>${average === null ? '—' : format(average, 1) + ' cm'}</strong></span><span>空值不参与胸径统计</span></div>
    <div class="table-scroll"><table><thead><tr>${columns.map(([key, title]) => `<th ${key === sortKey ? `aria-sort="${ascending ? 'ascending' : 'descending'}"` : ''}><button data-sort="${key}" aria-label="按${title}排序">${title}<span>${key === sortKey ? (ascending ? '↑' : '↓') : '↕'}</span></button></th>`).join('')}<th>胸径结果</th><th>组别</th></tr></thead><tbody>${trees.map((t) => `<tr class="${t.id === selected.id ? 'active-row' : ''}"><td><button class="table-tree-link" data-table-tree="${esc(t.id)}">${esc(t.id)}${icon('arrow')}</button></td><td>${format(t.height)}</td><td>${format(t.crownWidth)}</td><td>${format(t.crownLength)}</td><td>${t.dbh === null ? '<span class="null-value">—</span>' : format(t.dbh * 100, 1)}</td><td>${pointCount(t.points)}</td><td><span class="table-reliability ${t.dbhReliable ? 'reliable' : ''}">${t.dbhReliable ? '可信' : '暂无可靠结果'}</span></td><td>第 ${esc(t.group)} 组</td></tr>`).join('') || '<tr><td colspan="8" class="empty-table">没有匹配的树木，请重置筛选。</td></tr>'}</tbody></table></div><div class="table-foot">表中胸径以厘米显示；导出的 CSV 保留原表米单位与可信标记。</div>`;
  content.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.sort as SortKey;
    ascending = key === sortKey ? !ascending : true;
    sortKey = key;
    renderContent();
  }));
  content.querySelectorAll<HTMLButtonElement>('[data-table-tree]').forEach((button) => button.addEventListener('click', () => selectTree(button.dataset.tableTree!, true)));
}

function renderMap(content: HTMLElement) {
  const trees = currentTrees().filter((t) => t.group === mapGroup);
  const domain = dataset.trees.filter((t) => t.group === mapGroup);
  const rawX = domain.map((t) => t.x), rawY = domain.map((t) => t.y);
  const minX = Math.min(...rawX), maxX = Math.max(...rawX), minY = Math.min(...rawY), maxY = Math.max(...rawY);
  const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
  // Equal scale for both coordinate axes: preserve relative spatial distances.
  const scale = Math.min(650 / (spanX * 1.16), 380 / (spanY * 1.16));
  const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
  const cx = (x: number) => 420 + (x - centerX) * scale;
  const cy = (y: number) => 255 - (y - centerY) * scale;
  const hitRadius = (tree: Tree) => Math.max(2, Math.min(15, ...trees.filter((t) => t.id !== tree.id).map((t) => Math.hypot(t.x - tree.x, t.y - tree.y) * scale * .45)));
  const ticks = Array.from({ length: 6 }, (_, i) => i / 5);
  const worldWidth = 650 / scale, worldHeight = 380 / scale;
  const grid = ticks.map((t) => { const x = 95 + 650 * t, y = 65 + 380 * t; return `<line x1="${x}" y1="65" x2="${x}" y2="445"/><line x1="95" y1="${y}" x2="745" y2="${y}"/><text x="${x}" y="472" text-anchor="middle">${format(centerX - worldWidth / 2 + worldWidth * t, 1)}</text><text x="80" y="${y + 4}" text-anchor="end">${format(centerY + worldHeight / 2 - worldHeight * t, 1)}</text>`; }).join('');
  content.innerHTML = `<div class="map-panel"><div class="data-view-header"><div><span class="eyebrow">SCANNING POSITIONS</span><h2>扫描位置分布</h2><p>点击树木圆点，查看对应参数。</p></div></div><div class="map-toolbar"><div class="segmented" aria-label="位置图扫描组别" role="group"><button data-map-group="1" aria-pressed="${mapGroup === '1'}" class="${mapGroup === '1' ? 'active' : ''}">第 1 组</button><button data-map-group="2" aria-pressed="${mapGroup === '2'}" class="${mapGroup === '2' ? 'active' : ''}">第 2 组</button></div><span>当前显示 ${trees.length} 棵</span></div>
    <div class="map-canvas"><svg id="position-map" viewBox="0 0 800 520" role="group" aria-label="第 ${mapGroup} 组树木扫描坐标分布"><g class="map-grid">${grid}</g><text class="axis-label" x="420" y="508" text-anchor="middle">位置 X / 扫描坐标</text><text class="axis-label" x="24" y="255" text-anchor="middle" transform="rotate(-90 24 255)">位置 Y / 扫描坐标</text>${trees.map((t) => `<g class="map-point ${selected.id === t.id ? 'selected' : ''}" data-tree="${esc(t.id)}" role="button" tabindex="0" aria-label="树木 ${esc(t.id)}，树高 ${format(t.height)} 米"><title>${esc(t.id)} · ${format(t.height)} m</title><circle class="point-hit" cx="${cx(t.x)}" cy="${cy(t.y)}" r="${hitRadius(t)}"/><circle class="point-halo" cx="${cx(t.x)}" cy="${cy(t.y)}" r="11"/><circle class="point-dot" cx="${cx(t.x)}" cy="${cy(t.y)}" r="5.5"/>${selected.id === t.id ? `<text class="point-label" x="${cx(t.x) + 15}" y="${cy(t.y) + 4}">${esc(t.id)}</text>` : ''}</g>`).join('')}</svg>${trees.length ? '' : '<div class="map-empty">本组没有符合筛选条件的树木。</div>'}</div>
    <div class="map-legend"><span><i></i>扫描树木</span><span><i class="selected-dot"></i>当前选择</span></div><p class="map-note">此图使用扫描 X/Y 坐标，两组分别展示；不对应卫星地图或经纬度。</p></div><aside class="details-panel" id="details" aria-label="当前树木参数">${detailMarkup()}</aside>`;
  content.querySelectorAll<HTMLButtonElement>('[data-map-group]').forEach((button) => button.addEventListener('click', () => {
    mapGroup = button.dataset.mapGroup!;
    const first = dataset.trees.find((t) => t.group === mapGroup)!;
    if (selected.group !== mapGroup) { selected = first; renderDirectory(); updateUrl(); }
    renderContent();
  }));
  const svg = document.getElementById('position-map')!;
  svg.addEventListener('click', (event) => { const point = (event.target as Element).closest<SVGElement>('[data-tree]'); if (point) selectTree(point.dataset.tree!); });
  svg.addEventListener('keydown', (event) => {
    const e = event as KeyboardEvent;
    const point = (e.target as Element).closest<SVGElement>('[data-tree]');
    if (point && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectTree(point.dataset.tree!); }
  });
}

function bindContentEvents(content: HTMLElement) {
  // Replace the delegate on every content render (no accumulated listeners).
  content.onclick = (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-action]');
    if (!button) return;
    switch (button.dataset.action) {
      case 'reset-view': viewer?.reset(); break;
      case 'rotate': rotating = !rotating; viewer?.setRotating(rotating); button.classList.toggle('active', rotating); button.setAttribute('aria-pressed', String(rotating)); break;
      case 'open-browse': view = 'browse'; renderContent(); updateUrl(); break;
      case 'export': downloadCsv(); break;
      case 'fullscreen': void document.getElementById('viewer')?.requestFullscreen?.().catch(() => toast('当前浏览器不支持全屏，请使用横屏查看。')); break;
      case 'share': void shareTree(); break;
    }
  };
}

async function shareTree() {
  updateUrl();
  try { await navigator.clipboard.writeText(window.location.href); toast('这棵树的分享链接已复制'); }
  catch { window.prompt('复制这棵树的分享链接', window.location.href); }
}

function downloadCsv() {
  const trees = sortTrees(currentTrees(), sortKey, ascending);
  if (!trees.length) { toast('没有可导出的筛选结果'); return; }
  const url = URL.createObjectURL(new Blob([exportCsv(trees)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `Tree_Params_${trees.length}_trees.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`已导出 ${trees.length} 棵树的参数`);
}

async function boot() {
  try {
    const response = await fetch(assetUrl('data/trees.json'));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as Dataset;
    if (payload.schemaVersion !== 1 || !Array.isArray(payload.trees) || !payload.trees.length) throw new Error('Invalid dataset');
    dataset = payload;
    selected = dataset.trees.find((t) => t.id === query.get('tree')) ?? dataset.trees[0];
    mapGroup = selected.group;
    renderShell();
    updateUrl();
  } catch {
    app.innerHTML = `<div class="boot-error"><span class="brand-mark">${icon('leaf')}</span><h1>树木档案暂时无法载入</h1><p>请检查网络后重试。本地版需要通过随附的启动程序打开。</p><button class="button primary" id="boot-retry">重新加载</button><a href="${assetUrl('data/All_Tree_Params.csv')}">下载参数原表</a></div>`;
    document.getElementById('boot-retry')!.addEventListener('click', () => window.location.reload());
  }
}

window.addEventListener('pagehide', () => viewer?.dispose());
void boot();
