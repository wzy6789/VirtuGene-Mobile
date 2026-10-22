"""Read original .blend files only; never resave or render them."""
import bpy,json,hashlib
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
from pathlib import Path
HERE=Path(__file__).resolve().parent
result={}
for sid in ['snow-study','mist-coast']:
    path=HERE/sid/f'VirtuGene-{sid}-Original.blend'
    bpy.ops.wm.open_mainfile(filepath=str(path))
    s=bpy.context.scene;c=s.camera
    external=[{'name':im.name,'filepath':im.filepath} for im in bpy.data.images if im.source=='FILE' and im.filepath and not im.packed_file]
    assert not external,external
    assert s.get('scene_id')==sid
    assert (s.render.resolution_x,s.render.resolution_y)==(1440,3200)
    names=sorted(o.name for o in s.objects)
    camera={'location':list(c.location),'rotation':list(c.rotation_euler),'lens':c.data.lens,'sensorFit':c.data.sensor_fit,'sensorHeight':c.data.sensor_height}
    metadata=json.loads((HERE/sid/'camera-export.json').read_text(encoding='utf8'))
    assert camera==metadata['camera'],(camera,metadata['camera'])
    anchors={}
    if sid=='snow-study':
        cup=s.objects.get('Single open steaming tea cup');assert cup is not None
        points=[cup.matrix_world@v.co for v in cup.data.vertices]
        lip_z=max(p.z for p in points);lip=[p for p in points if abs(p.z-lip_z)<.0001]
        centre=sum(lip,Vector())/len(lip)
        projected=world_to_camera_view(s,c,centre)
        mouth=[projected.x*1440,(1-projected.y)*3200]
        error=max(abs(mouth[i]-metadata['cupMouth'][i]) for i in [0,1]);assert error<.01,(mouth,error)
        anchors['actualCupLipProjected']=mouth;anchors['cupMouthDesignPixelError']=error
        lamp=s.objects.get('Parchment lamp conical shade');assert lamp is not None
        lp=world_to_camera_view(s,c,lamp.location);point=[lp.x*1440,(1-lp.y)*3200]
        x,y,w,h=metadata['lightRect'];assert x<=point[0]<=x+w and y<=point[1]<=y+h
        anchors['actualLampProjected']=point;anchors['lightRectContainsVisibleLamp']=True
    else:
        assert 'cupMouth' not in metadata
        assert not any('tea cup' in name.lower() for name in names)
        anchors['noFakeSteamAnchor']=True
    result[sid]={'blendFile':str(path),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
        'objects':len(names),'meshes':len(bpy.data.meshes),'materials':len(bpy.data.materials),'externalImages':external,
        'camera':camera,'objectNameSignature':hashlib.sha256('\n'.join(names).encode()).hexdigest(),
        'sourceSceneOriginal':bool(s.get('virtugene_original')),'cyclesDevice':s.cycles.device,'threadLimit':s.render.threads,'anchors':anchors}
assert result['snow-study']['objectNameSignature']!=result['mist-coast']['objectNameSignature']
(HERE/'blend-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print('PASS original Blender source and independent geometry audit')
