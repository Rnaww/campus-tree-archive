import type { Filters, Tree } from './types';

export const assetUrl = (path: string): string => `${import.meta.env.BASE_URL}${path}`;
export const format = (value: number | null, decimals = 2): string => value === null ? '—' : value.toFixed(decimals);
export const pointCount = (value: number): string => new Intl.NumberFormat('zh-CN').format(value);
export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function filterTrees(trees: Tree[], filters: Filters): Tree[] {
  const query = filters.query.trim().toLowerCase();
  return trees.filter((t) => {
    if (query && !t.id.toLowerCase().includes(query)) return false;
    if (filters.group !== 'all' && t.group !== filters.group) return false;
    if (filters.reliability === 'reliable' && !t.dbhReliable) return false;
    if (filters.reliability === 'missing' && t.dbhReliable) return false;
    if (filters.height === 'under10' && t.height >= 10) return false;
    if (filters.height === '10to15' && (t.height < 10 || t.height >= 15)) return false;
    if (filters.height === '15to20' && (t.height < 15 || t.height >= 20)) return false;
    if (filters.height === 'over20' && t.height < 20) return false;
    return true;
  });
}

export type SortKey = 'id' | 'height' | 'crownWidth' | 'crownLength' | 'dbh' | 'points';
export function sortTrees(trees: Tree[], key: SortKey, ascending: boolean): Tree[] {
  return [...trees].sort((a, b) => {
    const av = a[key], bv = b[key];
    // Missing diameters stay last in either direction.
    if (av === null && bv === null) return a.id.localeCompare(b.id);
    if (av === null) return 1;
    if (bv === null) return -1;
    const delta = typeof av === 'string' ? av.localeCompare(bv as string) : av - (bv as number);
    return (ascending ? delta : -delta) || a.id.localeCompare(b.id);
  });
}

const csvCell = (value: string | number | null): string => {
  const text = value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
export function exportCsv(trees: Tree[]): string {
  const columns = ['编号', 'Tree_ID', 'Source_File', 'Position_X', 'Position_Y', 'Tree_Height(m)', 'Crown_Width(m)', 'Crown_Length(m)', 'DBH_Avg(m)', 'DBH_Reliable', 'Trunk_Top_Height(m)', 'Points'];
  const rows = trees.map((t) => [t.id, t.treeId, t.sourceFile, t.x, t.y, t.height, t.crownWidth, t.crownLength, t.dbh, t.dbhReliable ? 'True' : 'False', t.trunkTopHeight, t.points]);
  return '\uFEFF' + [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

