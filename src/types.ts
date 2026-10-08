export type Quality = 'lite' | 'high';
export type View = 'browse' | 'table' | 'map';
export interface Tree {
  id: string;
  group: string;
  treeId: string;
  sourceFile: string;
  x: number;
  y: number;
  height: number;
  crownWidth: number;
  crownLength: number;
  dbh: number | null;
  dbhReliable: boolean;
  trunkTopHeight: number;
  points: number;
  offset: [number, number, number];
  bounds: [[number, number, number], [number, number, number]];
  thumbnail: string;
  models: Record<Quality, { path: string; points: number; bytes: number }>;
}
export interface Dataset {
  schemaVersion: number;
  source: { file: string; sha256: string; origin: string; coordinateSystem: string; sampling: string };
  trees: Tree[];
}
export interface Filters { query: string; group: string; height: string; reliability: string }

