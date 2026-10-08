"""Validate every published model and parameter without optional dependencies."""
from pathlib import Path
import csv
import hashlib
import json
import math
import struct

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"


def validate():
    payload = json.loads((PUBLIC / "data/trees.json").read_text(encoding="utf-8"))
    raw = (PUBLIC / "data/All_Tree_Params.csv").read_bytes()
    rows = list(csv.DictReader(raw.decode("utf-8-sig").splitlines()))
    report = json.loads((PUBLIC / "data/validation-report.json").read_text(encoding="utf-8"))
    assert payload["schemaVersion"] == 1
    assert hashlib.sha256(raw).hexdigest() == payload["source"]["sha256"] == report["sourceSha256"]
    source = {row["编号"]: row for row in rows}
    trees = payload["trees"]
    assert len(trees) == len(source) == len(rows) == 68, "Expected 68 unique records"
    assert {t["id"] for t in trees} == set(source)
    groups = {g: sum(t["group"] == g for t in trees) for g in ["1", "2"]}
    assert groups == {"1": 33, "2": 35} == report["groups"]
    numeric_fields = {"x": "Position_X", "y": "Position_Y", "height": "Tree_Height(m)",
                      "crownWidth": "Crown_Width(m)", "crownLength": "Crown_Length(m)",
                      "dbh": "DBH_Avg(m)", "trunkTopHeight": "Trunk_Top_Height(m)"}
    model_count, display_points = 0, 0
    for tree in trees:
        row = source[tree["id"]]
        assert tree["group"] == tree["id"].split("-")[0]
        assert tree["treeId"] == row["Tree_ID"] and tree["sourceFile"] == row["Source_File"]
        for field, column in numeric_fields.items():
            expected = float(row[column]) if row[column] else None
            assert tree[field] == expected, f"{tree['id']}/{field}: differs from authoritative CSV"
        assert tree["dbhReliable"] == (row["DBH_Reliable"] == "True")
        assert tree["dbhReliable"] == (tree["dbh"] is not None)
        assert tree["points"] == int(row["Points"])
        assert all(math.isfinite(v) for v in tree["offset"])
        thumbnail = PUBLIC / tree["thumbnail"]
        image = thumbnail.read_bytes()
        assert image[:4] == b"RIFF" and image[8:12] == b"WEBP", f"Invalid preview: {thumbnail}"
        for quality, cap in [("lite", 50_000), ("high", 200_000)]:
            info = tree["models"][quality]
            path = PUBLIC / info["path"]
            content = path.read_bytes()
            header_bytes, vertices = content.split(b"end_header\n", 1)
            header = header_bytes.decode("ascii")
            assert "format binary_little_endian 1.0" in header
            assert f"element vertex {info['points']}\n" in header
            assert header.count("property ") == 6
            assert len(vertices) == info["points"] * 15
            assert len(content) == info["bytes"]
            assert 0 < info["points"] <= min(tree["points"], cap)
            low, high = [math.inf] * 3, [-math.inf] * 3
            for vertex in struct.iter_unpack("<fffBBB", vertices):
                for j in range(3):
                    value = vertex[j]
                    assert math.isfinite(value), f"Non-finite coordinate: {path}"
                    low[j] = min(low[j], value)
                    high[j] = max(high[j], value)
            for j in range(3):
                assert abs(low[j] - tree["bounds"][0][j]) < .001
                assert abs(high[j] - tree["bounds"][1][j]) < .001
            model_count += 1
            display_points += info["points"]
    reliable = sum(t["dbhReliable"] for t in trees)
    assert reliable == report["reliableDBH"] == 26
    assert sum(t["dbh"] is None for t in trees) == report["missingDBH"] == 42
    assert sum(t["points"] for t in trees) == report["originalPoints"] == 17_346_793
    assert len(list((PUBLIC / "models").glob("*.ply"))) == model_count == 136
    assert len(list((PUBLIC / "thumbnails").glob("*.webp"))) == 68
    size = sum(p.stat().st_size for p in PUBLIC.rglob("*") if p.is_file())
    assert size < 300 * 2**20, "Publication assets exceed 300 MiB target"
    print(f"PASS: {len(trees)} trees, {model_count} models, {display_points:,} display points, {size / 2**20:.1f} MiB")
    print(f"PASS: authoritative SHA-256 {payload['source']['sha256']}")
    print("PASS: 26 reliable diameters; 42 missing; full model bounds and coordinates verified")


if __name__ == "__main__":
    validate()
