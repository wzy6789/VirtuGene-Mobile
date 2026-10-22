"""Read the saved original .blend without modifying or saving it."""
from pathlib import Path
import json
import bpy

here = Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(here / "VirtuGene-Cafe-Original.blend"))
scene = bpy.context.scene
camera = scene.camera
actual = {"location": list(camera.location), "rotation": list(camera.rotation_euler),
          "lens": camera.data.lens, "sensorFit": camera.data.sensor_fit,
          "sensorHeight": camera.data.sensor_height}
expected = json.loads((here / "camera-export.json").read_text(encoding="utf8"))["camera"]
assert actual == expected, (actual, expected)
required = ["Single coffee cup open vessel", "Foreground round oak tabletop",
            "Banquette upholstered back", "Window center mullion",
            "Espresso machine body", "Plant handmade clay pot"]
for name in required:
    assert name in bpy.data.objects, name
result = {"status": "pass", "blenderVersion": bpy.app.version_string,
          "renderEngine": scene.render.engine, "sourceDimensions": [scene.render.resolution_x, scene.render.resolution_y],
          "camera": actual, "cameraMatchesBothRuntimeVariants": True,
          "requiredAuthoredObjectsPresent": required,
          "meshCount": sum(obj.type == "MESH" for obj in scene.objects),
          "curveCount": sum(obj.type == "CURVE" for obj in scene.objects),
          "externalImages": [image.filepath for image in bpy.data.images if image.source == "FILE"],
          "externalLibraries": [library.filepath for library in bpy.data.libraries],
          "model": "未确认", "reasoning": "未确认", "savedBlendModified": False}
(here / "blend-audit.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf8")
print("PASS saved original Blender scene audit")
