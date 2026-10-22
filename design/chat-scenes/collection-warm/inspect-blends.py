"""Open actual authored .blend files and inspect cameras/dependencies, no render."""
import bpy,json,hashlib
from pathlib import Path
HERE=Path(__file__).resolve().parent;report=[]
for sid in ['hearth-cabin','night-train']:
    root=HERE/sid;p=root/f'VirtuGene-{sid}-Original.blend'
    bpy.ops.wm.open_mainfile(filepath=str(p))
    s=bpy.context.scene;cam=s.camera
    metadata=json.loads((root/'camera-export.json').read_text(encoding='utf8'))['camera']
    actual={'location':list(cam.location),'rotation':list(cam.rotation_euler),'lens':cam.data.lens,'sensorFit':cam.data.sensor_fit,'sensorHeight':cam.data.sensor_height}
    for key in ['location','rotation']:
        assert max(abs(a-b) for a,b in zip(actual[key],metadata[key]))<1e-6
    assert actual['lens']==metadata['lens'] and actual['sensorFit']=='VERTICAL' and actual['sensorHeight']==36
    images=[{'name':im.name,'path':im.filepath} for im in bpy.data.images if im.filepath]
    libs=[lib.filepath for lib in bpy.data.libraries]
    assert not images and not libs
    assert (s.render.resolution_x,s.render.resolution_y)==(1440,3200)
    assert len([o for o in s.objects if o.type=='CAMERA'])==1
    report.append({'scene':sid,'openedActualBlend':True,'cameraMatchesDesignMetadata':True,'designDimensions':[1440,3200],'objectCount':len(s.objects),'materials':len(bpy.data.materials),'meshAndCurveCount':len([o for o in s.objects if o.type in ['MESH','CURVE']]),'externalImagePaths':images,'externalLibraries':libs,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(HERE/'blend-inspection.json').write_text(json.dumps({'passed':True,'scenes':report},indent=2),encoding='utf8')
print(json.dumps({'passed':True,'scenes':report},indent=2))
