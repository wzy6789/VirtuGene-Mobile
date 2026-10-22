"""Independent offline asset audit; does not start the application or render.

Checks actual source pixels, shared metadata, neutral compositing and the full
allowed foreground displacement against the authored rain visibility matte.
"""
from pathlib import Path
from PIL import Image, ImageChops
import hashlib
import json

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
checks = []


def check(name, passed, **facts):
    checks.append({"name": name, "pass": bool(passed), **facts})
    if not passed:
        raise AssertionError(name)


variants = ["cafe-afternoon", "cafe-rain-night"]
metadata = [json.loads((ROOT / "src/assets/chat-scenes" / variant /
                       "scene-export.json").read_text(encoding="utf8"))
            for variant in variants]
check("variants/exact-same-camera", metadata[0]["camera"] == metadata[1]["camera"])
for key in ["designWidth", "designHeight", "cupMouth", "windowPolygon"]:
    check("variants/same-" + key, metadata[0][key] == metadata[1][key])
check("original/blend-file-present", (HERE / "VirtuGene-Cafe-Original.blend").stat().st_size > 100000)
blend_audit = json.loads((HERE / "blend-audit.json").read_text(encoding="utf8"))
check("original/actual-blend-camera", blend_audit["status"] == "pass" and blend_audit["camera"] == metadata[0]["camera"])
check("original/no-external-libraries-or-images", not blend_audit["externalImages"] and not blend_audit["externalLibraries"])

clean_mask = lambda value: 0 if value < 16 else (255 if value > 239 else value)
window = Image.open(HERE / "window-occlusion-mask.png").convert("L").point(clean_mask)
casing = Image.open(HERE / "casing-occlusion-mask.png").convert("L").point(clean_mask)
check("window/nonempty-local-bounds", window.getbbox() == (765, 985, 1440, 1769), bounds=window.getbbox())

for variant, meta in zip(variants, metadata):
    source = HERE / ("source-" + variant + "-2160.png")
    with Image.open(source) as image:
        check(variant + "/real-source-dimensions", image.size == (2160, 4800), dimensions=image.size)
    check(variant + "/source-file-not-placeholder", source.stat().st_size > 1000000,
          bytes=source.stat().st_size, sha256=hashlib.sha256(source.read_bytes()).hexdigest())
    provenance = json.loads((ROOT / "src/assets/chat-scenes" / variant / "asset-provenance.json").read_text(encoding="utf8"))
    check(variant + "/source-provenance-matches", provenance["authoredSource"]["sha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
          and (provenance["authoredSource"]["width"], provenance["authoredSource"]["height"]) == (2160, 4800))
    folder = HERE / "renders" / variant
    base = Image.open(folder / "base.png").convert("RGBA")
    check(variant + "/clean-plate-full-opacity", base.getextrema()[3] == (255, 255))
    for name in ["casing", "plant", "table"]:
        layer = Image.open(folder / (name + ".png")).convert("RGBA")
        if name == "casing":
            layer.putalpha(ImageChops.multiply(layer.getchannel("A"), casing))
        base.alpha_composite(layer)
        if name in ["plant", "table"]:
            radius = meta["motion"][name + "MaxDesignPixels"]
            alpha = layer.getchannel("A")
            worst = 0
            for dx in [-radius, 0, radius]:
                for dy in [-radius, 0, radius]:
                    shifted = Image.new("L", alpha.size)
                    shifted.paste(alpha, (dx, dy))
                    worst = max(worst, ImageChops.multiply(window, shifted).getextrema()[1])
            check(variant + "/" + name + "/no-rain-overlap-at-max-parallax", worst == 0,
                  maxDesignPixels=radius, maxOverlapAlpha=worst)
    poster = Image.open(folder / "poster-composite.png").convert("RGBA")
    difference = max(high for low, high in ImageChops.difference(base, poster).getextrema())
    check(variant + "/neutral-png-composite-pixel-identical", difference == 0,
          maxChannelDifference=difference)
    for quality, data in meta["qualities"].items():
        check(variant + "/" + quality + "/decode-budget",
              data["decodedBytesWithPoster"] <= 64 * 1024 * 1024,
              decodedBytesWithPoster=data["decodedBytesWithPoster"],
              decodedBytesAfterPosterRelease=data["decodedBytesAfterPosterRelease"])
        for item in [data["windowMask"], *data["layers"]]:
            check(variant + "/" + quality + "/" + item["file"] + "/cropped",
                  item["width"] * item["height"] < data["width"] * data["height"])

result = {"status": "pass", "checkCount": len(checks), "checks": checks,
          "workingDirectory": str(ROOT), "model": "未确认", "reasoning": "未确认",
          "scope": "Offline assets only, no Android GPU or application interaction",
          "visualReview": {"inspected": ["composite-afternoon-preview.png", "composite-rain-night-preview.png", "alpha-edges-light-dark.png", "source-cafe-rain-night-2160.png"],
                           "observed": "Recognizable seat, cup, table, plant and window depth. No obvious white/black fringe in the exported edge sheet.",
                           "limitations": "No quantitative moire guarantee or native GPU evidence; verify actual app at target sizes separately."}}
(HERE / "final-asset-audit.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf8")
print("PASS", len(checks), "independent final asset checks")
