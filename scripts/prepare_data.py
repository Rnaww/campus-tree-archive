"""Build public display assets from original PLYs and the authoritative CSV.

Original files are read-only inputs. Runtime and CI only need committed assets.
"""
from pathlib import Path
import argparse
import csv
import hashlib
import json
import shutil
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
PLY_TYPES = {"char": "i1", "uchar": "u1", "short": "<i2", "ushort": "<u2",
             "int": "<i4", "uint": "<u4", "float": "<f4", "double": "<f8"}
OUT_TYPE = np.dtype([(k, "<f4") for k in ("x", "y", "z")] + [(k, "u1") for k in ("red", "green", "blue")])


def read_ply(path):
    with path.open("rb") as f:
        if f.readline().strip() != b"ply":
            raise ValueError(f"Not a PLY: {path}")
        properties, count, element, fmt = [], None, None, None
        while True:
            line = f.readline()
            if not line:
                raise ValueError(f"Incomplete header: {path}")
            parts = line.decode("ascii").split()
            if parts[0] == "format":
                fmt = parts[1]
            elif parts[0] == "element":
                element = parts[1]
                if element == "vertex":
                    count = int(parts[2])
            elif parts[0] == "property" and element == "vertex":
                if parts[1] not in PLY_TYPES:
                    raise ValueError(f"Unsupported vertex property: {line!r}")
                properties.append((parts[2], PLY_TYPES[parts[1]]))
            elif parts[0] == "end_header":
                offset = f.tell()
                break
    if fmt != "binary_little_endian" or not count:
        raise ValueError(f"Expected nonempty binary little-endian PLY: {path}")
    dtype = np.dtype(properties)
    if path.stat().st_size < offset + count * dtype.itemsize:
        raise ValueError(f"Truncated PLY: {path}")
    return np.memmap(path, dtype=dtype, offset=offset, mode="r", shape=(count,))


def spatial_sample(xyz, cap, voxel):
    """One original point per voxel, followed by deterministic spatial sampling.

    Keep axis extrema to preserve the cloud's full bounding box.
    """
    if len(xyz) <= cap:
        return np.arange(len(xyz))
    grid = np.floor((xyz - xyz.min(axis=0)) / voxel).astype(np.int64)
    dims = grid.max(axis=0) + 1
    keys = (grid[:, 0] * dims[1] + grid[:, 1]) * dims[2] + grid[:, 2]
    _, indices = np.unique(keys, return_index=True)
    extrema = np.unique(np.r_[xyz.argmin(axis=0), xyz.argmax(axis=0)])
    if len(indices) > cap - len(extrema):
        indices = indices[np.linspace(0, len(indices) - 1, cap - len(extrema), dtype=np.int64)]
    return np.unique(np.r_[indices, extrema])


def write_ply(path, xyz, rgb):
    vertices = np.empty(len(xyz), dtype=OUT_TYPE)
    for j, key in enumerate(("x", "y", "z")):
        vertices[key] = xyz[:, j]
    for j, key in enumerate(("red", "green", "blue")):
        vertices[key] = rgb[:, j]
    header = ("ply\nformat binary_little_endian 1.0\ncomment Display sample; original measurements unchanged\n"
              f"element vertex {len(vertices)}\nproperty float x\nproperty float y\nproperty float z\n"
              "property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n")
    with path.open("wb") as f:
        f.write(header.encode("ascii"))
        vertices.tofile(f)


def thumbnail(path, xyz, rgb):
    """Orthographic rendering of actual sampled points, with depth sorting."""
    width, height, scale = 480, 400, 2
    img = Image.new("RGB", (width * scale, height * scale), "#edf1e9")
    # A slightly elevated diagonal view, Z remains vertical.
    horizontal = xyz[:, 0] * .819 + xyz[:, 1] * .574
    depth = -xyz[:, 0] * .574 + xyz[:, 1] * .819
    vertical = xyz[:, 2] * .97 - depth * .243
    fit = min((width - 70) / max(float(np.ptp(horizontal)), .1),
              (height - 60) / max(float(np.ptp(vertical)), .1))
    px = ((horizontal - (horizontal.min() + horizontal.max()) / 2) * fit + width / 2) * scale
    py = (height - 28 - (vertical - vertical.min()) * fit) * scale
    draw = ImageDraw.Draw(img)
    order = np.argsort(depth)
    for i in order:
        x, y = int(px[i]), int(py[i])
        color = tuple(int(v) for v in np.clip(rgb[i].astype(float) * 1.12 + 8, 0, 255))
        draw.ellipse((x - 1, y - 1, x + 1, y + 1), fill=color)
    img.resize((width, height), Image.Resampling.LANCZOS).save(path, "WEBP", quality=85)


def number(row, column):
    value = row[column].strip()
    if not value:
        return None
    result = float(value)
    if not np.isfinite(result):
        raise ValueError(f"Invalid number in {row['编号']}/{column}")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, default=ROOT.parent)
    parser.add_argument("--params", type=Path, default=ROOT.parent.parent / "All_Tree_Params.csv")
    args = parser.parse_args()
    raw = args.params.read_bytes()
    rows = list(csv.DictReader(raw.decode("utf-8-sig").splitlines()))
    ids = [r["编号"] for r in rows]
    if len(ids) != len(set(ids)) or not ids:
        raise ValueError("CSV must contain unique tree identifiers")
    if "DBH_Reliable" not in rows[0]:
        raise ValueError("Use the authoritative CSV with DBH_Reliable, not the older extraction")
    ply_ids = {p.stem for p in args.input_dir.glob("*.ply")}
    if set(ids) != ply_ids:
        raise ValueError(f"CSV/PLY mismatch: {set(ids) ^ ply_ids}")
    data = ROOT / "public/data"
    models = ROOT / "public/models"
    thumbs = ROOT / "public/thumbnails"
    for directory in (data, models, thumbs):
        directory.mkdir(parents=True, exist_ok=True)
    trees = []
    for row in sorted(rows, key=lambda r: r["编号"]):
        tree_id = row["编号"]
        arr = read_ply(args.input_dir / f"{tree_id}.ply")
        if len(arr) != int(row["Points"]):
            raise ValueError(f"Point count mismatch: {tree_id}")
        xyz = np.column_stack([arr[k] for k in ("x", "y", "z")])
        rgb = np.column_stack([arr[k] for k in ("red", "green", "blue")])
        if not np.isfinite(xyz).all():
            raise ValueError(f"Non-finite positions: {tree_id}")
        low, high = xyz.min(axis=0), xyz.max(axis=0)
        offset = np.array([(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, low[2]], dtype=np.float32)
        xyz = xyz - offset
        high_indices = spatial_sample(xyz, 200_000, .025)
        high_xyz, high_rgb = xyz[high_indices], rgb[high_indices]
        lite_indices = spatial_sample(high_xyz, 50_000, .05)
        lite_xyz, lite_rgb = high_xyz[lite_indices], high_rgb[lite_indices]
        write_ply(models / f"{tree_id}-high.ply", high_xyz, high_rgb)
        write_ply(models / f"{tree_id}-lite.ply", lite_xyz, lite_rgb)
        thumbnail(thumbs / f"{tree_id}.webp", lite_xyz, lite_rgb)
        flag = row["DBH_Reliable"].strip().lower()
        if flag not in ("true", "false"):
            raise ValueError(f"Invalid reliability flag: {tree_id}")
        reliable = flag == "true"
        dbh = number(row, "DBH_Avg(m)")
        if (reliable and dbh is None) or (not reliable and dbh is not None):
            raise ValueError(f"Conflicting DBH reliability: {tree_id}")
        trees.append({
            "id": tree_id, "group": tree_id.split("-")[0], "treeId": row["Tree_ID"],
            "sourceFile": row["Source_File"], "x": number(row, "Position_X"), "y": number(row, "Position_Y"),
            "height": number(row, "Tree_Height(m)"), "crownWidth": number(row, "Crown_Width(m)"),
            "crownLength": number(row, "Crown_Length(m)"), "dbh": dbh, "dbhReliable": reliable,
            "trunkTopHeight": number(row, "Trunk_Top_Height(m)"), "points": len(arr),
            "offset": offset.tolist(), "bounds": [(low - offset).tolist(), (high - offset).tolist()],
            "thumbnail": f"thumbnails/{tree_id}.webp",
            "models": {quality: {"path": f"models/{tree_id}-{quality}.ply", "points": n,
                                 "bytes": (models / f"{tree_id}-{quality}.ply").stat().st_size}
                       for quality, n in [("lite", len(lite_xyz)), ("high", len(high_xyz))]},
        })
        print(f"{tree_id}: {len(arr):,} → {len(high_xyz):,} / {len(lite_xyz):,}", flush=True)
    payload = {"schemaVersion": 1, "source": {"file": "All_Tree_Params.csv", "sha256": hashlib.sha256(raw).hexdigest(),
                "origin": "Downloads/All_Tree_Params.csv", "coordinateSystem": "扫描坐标，未提供地理坐标系",
                "sampling": "0.025m/0.05m体素代表点与确定性空间抽样，保留坐标极值"}, "trees": trees}
    shutil.copyfile(args.params, data / "All_Tree_Params.csv")
    (data / "trees.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    old_path = next(args.input_dir.glob("提取参数_*/All_Tree_Params.csv"), None)
    differences = []
    if old_path:
        old_rows = {r["编号"]: r for r in csv.DictReader(old_path.open(encoding="utf-8-sig"))}
        for row in rows:
            old = old_rows.get(row["编号"], {})
            for column in old.keys() & row.keys():
                if old[column] != row[column]:
                    differences.append({"id": row["编号"], "field": column, "old": old[column], "authoritative": row[column]})
    report = {"trees": len(trees), "groups": {g: sum(t['group'] == g for t in trees) for g in ['1', '2']},
              "originalPoints": sum(t['points'] for t in trees), "reliableDBH": sum(t['dbhReliable'] for t in trees),
              "missingDBH": sum(t['dbh'] is None for t in trees), "sourceSha256": payload['source']['sha256'],
              "oldComparisonAvailable": bool(old_path), "changedRows": len({d['id'] for d in differences}), "differences": differences}
    (data / "validation-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    total = sum(p.stat().st_size for p in (ROOT / "public").rglob("*") if p.is_file())
    print(f"Complete: {len(trees)} trees; public assets {total / 2**20:.1f} MiB")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Data preparation failed: {exc}", file=sys.stderr)
        raise
