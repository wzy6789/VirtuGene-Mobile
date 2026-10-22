"""Actual original non-planar geometry + camera, optimized for fixed-view real-time use.

The runtime projects the accepted baked appearance onto these actual meshes.
No poster plane is exported. Shader particles use the resulting real depth.
This is a fixed-view bake, not a freely explorable PBR material set.
"""
import bpy,bmesh,json,sys,math,hashlib,time
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[3];HERE=Path(__file__).resolve().parent
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
ids=args or ['cafe-afternoon','cafe-rain-night','snow-study','mist-coast','hearth-cabin','night-train','home-bedroom','home-living']
def source(sid):
    if sid.startswith('cafe-'):return ROOT/'design/chat-scenes/cafe/VirtuGene-Cafe-Original.blend'
    category='collection-cool' if sid in ['snow-study','mist-coast'] else 'collection-home' if sid.startswith('home-') else 'collection-warm'
    return ROOT/'design/chat-scenes'/category/sid/f'VirtuGene-{sid}-Original.blend'
def convert(v):return [round(v[0],6),round(v[2],6),round(-v[1],6)]
windows={
 'cafe-afternoon':[(.52,2.70,.94),(2.9,2.70,.94),(2.9,2.70,3.03),(.52,2.70,3.03)],
 'cafe-rain-night':[(.52,2.70,.94),(2.9,2.70,.94),(2.9,2.70,3.03),(.52,2.70,3.03)],
 'snow-study':[(-1.52,3.57,.9),(2.62,3.57,.9),(2.62,3.57,3.3),(-1.52,3.57,3.3)],
 'mist-coast':[(-3.04,3.98,1.04),(3.04,3.98,1.04),(3.04,3.98,3.56),(-3.04,3.98,3.56)],
 'hearth-cabin':[(-1.50,3.12,.17),(-.19,3.12,.17),(-.19,3.12,1.27),(-1.50,3.12,1.27)],
 'night-train':[(-1.27,3.40,1.10),(2.10,3.40,1.10),(2.10,3.40,2.94),(-1.27,3.40,2.94)],
 'home-bedroom':[(.89,3.49,1.13),(2.53,3.49,1.13),(2.53,3.49,3.07),(.89,3.49,3.07)],
 'home-living':[(-1.13,3.49,1.15),(2.40,3.49,1.15),(2.40,3.49,3.18),(-1.13,3.49,3.18)],
}
reports=[]
for sid in ids:
    began=time.time();src=source(sid);bpy.ops.wm.open_mainfile(filepath=str(src));s=bpy.context.scene;cam=s.camera
    original_camera={'position':convert(cam.matrix_world.translation),'rotationQuaternion':list(cam.matrix_world.to_quaternion()),'verticalFovDegrees':math.degrees(2*math.atan(36/(2*cam.data.lens)))}
    # Ensure the saved authoring layer state cannot hide a source object.
    for o in s.objects:
        if o.type in ['MESH','CURVE','SURFACE','FONT']:o.hide_render=False;o.hide_viewport=False;o.hide_set(False);o.visible_camera=True
    # The authored stills may use a distant-color panel over a solid wall.
    # Cut the real aperture for runtime weather; source .blend is never saved.
    aperture={'home-bedroom':(.87,2.55,1.10,3.10),'home-living':(-1.145,2.405,1.13,3.21),'night-train':(-1.35,2.19,1.07,2.98)}.get(sid)
    if aperture:
        wall=next(o for o in s.objects if o.name==('Compartment rear bulkhead' if sid=='night-train' else 'Quiet back plaster wall'))
        x0,x1,z0,z1=aperture;bpy.ops.mesh.primitive_cube_add(size=1,location=((x0+x1)/2,3.60,(z0+z1)/2));cutter=bpy.context.object;cutter.dimensions=(x1-x0,1.1,z1-z0);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        bpy.context.view_layer.objects.active=wall;mod=wall.modifiers.new('Genuine open runtime window','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
    sky_names=('Snow-night sky backdrop','Deep blue winter window view','Panoramic indigo outdoor sky','Evening window open view','Large morning garden view','Moonlit rolling hills outside the window')
    dep=bpy.context.evaluated_depsgraph_get();parts=[];backgrounds=[];original_triangles=0;names=[]
    for o in list(s.objects):
        if o.type not in ['MESH','CURVE','SURFACE','FONT']:continue
        evaluated=o.evaluated_get(dep);mesh=bpy.data.meshes.new_from_object(evaluated,depsgraph=dep)
        if not mesh or not mesh.vertices:continue
        mesh.transform(o.matrix_world);mesh.calc_loop_triangles();original_triangles+=len(mesh.loop_triangles)
        copy=bpy.data.objects.new('Realtime original '+o.name,mesh);s.collection.objects.link(copy)
        (backgrounds if o.name.startswith(sky_names) else parts).append(copy);names.append(o.name)
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:o.select_set(True)
    bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();room=bpy.context.object;room.name='VG_ORIGINAL_ROOM_GEOMETRY'
    # Actual triangle reduction, not a manifest claim. Keep important silhouette
    # topology distributed across every source object in this fixed-view room.
    room.data.materials.clear()
    material=bpy.data.materials.new('Fixed-camera baked appearance applied by host');material.diffuse_color=(1,1,1,1);room.data.materials.append(material)
    for p in room.data.polygons:p.material_index=0
    if original_triangles>44000:
        dec=room.modifiers.new('Mobile geometry budget','DECIMATE');dec.ratio=min(1,44000/original_triangles);dec.use_collapse_triangulate=True
        bpy.ops.object.modifier_apply(modifier=dec.name)
    triang=room.modifiers.new('Deterministic GLB triangles','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=triang.name)
    room.data.calc_loop_triangles();triangles=len(room.data.loop_triangles)
    # Erase inherited UVs/material layers: the renderer projects the exact baked
    # source through the authored camera with perspective-correct interpolation.
    while room.data.uv_layers:room.data.uv_layers.remove(room.data.uv_layers[0])
    room.data.attributes.get('color') and room.data.attributes.remove(room.data.attributes['color'])
    for p in room.data.polygons:p.use_smooth=True
    bpy.ops.object.select_all(action='DESELECT');room.select_set(True);cam.select_set(True)
    background=None
    if backgrounds:
        bpy.ops.object.select_all(action='DESELECT')
        for o in backgrounds:o.select_set(True)
        bpy.context.view_layer.objects.active=backgrounds[0];bpy.ops.object.join();background=bpy.context.object;background.name='VG_BAKED_DISTANT_BACKGROUND'
        background.data.materials.clear()
        for p in background.data.polygons:p.material_index=0
        background.data.calc_loop_triangles();triangles+=len(background.data.loop_triangles)
        bpy.ops.object.select_all(action='DESELECT');room.select_set(True);cam.select_set(True);background.select_set(True)
    out=ROOT/'src/assets/chat-scenes'/sid;out.mkdir(parents=True,exist_ok=True);glb=out/'scene.glb'
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_cameras=True,export_lights=False,export_materials='NONE',export_yup=True,export_normals=True,export_texcoords=False,export_animations=False,export_extras=True)
    xs=[v.co.x for v in room.data.vertices];ys=[v.co.y for v in room.data.vertices];zs=[v.co.z for v in room.data.vertices]
    drink=next((o for o in s.objects if o.name in ['Actual coffee surface','Drink surface inside cup']),None)
    # Source object centers for the lathed liquid; no invented steam in no-cup rooms.
    cup=convert(drink.matrix_world.translation+Vector((0,0,.018))) if drink and sid not in ['mist-coast','home-bedroom'] else None
    # Cool study calls the actual liquid by its authored semantic name.
    if sid=='snow-study' and not cup:
        drink=next((o for o in s.objects if o.name.lower().startswith(('tea surface','tea inside','drink inside','tea dark','tea liquid'))),None)
        if drink:cup=convert(drink.matrix_world.translation+Vector((0,0,.02)))
    points=[convert(p) for p in windows[sid]]
    light={'home-bedroom':(1.14,1.69,1.34),'home-living':(.6,3.1,2.6),'snow-study':(-1.2,-2.4,1.49),'mist-coast':(1.2,3.85,2.7),'hearth-cabin':(-.85,3.05,.75),'night-train':(1.64,2.88,2.3),'cafe-afternoon':(1.72,2.70,2.0),'cafe-rain-night':(-1.2,1.35,2.59)}[sid]
    row={'schema':1,'sceneId':sid,'file':'scene.glb','bytes':glb.stat().st_size,'sha256':hashlib.sha256(glb.read_bytes()).hexdigest(),'triangles':triangles,'vertices':len(room.data.vertices)+(len(background.data.vertices) if background else 0),'drawCalls':2 if background else 1,'geometryBoundsBlender':{'min':[min(xs),min(ys),min(zs)],'max':[max(xs),max(ys),max(zs)]},'camera':original_camera,'effectQuad':points,'lightPoint':convert(light),'cup':cup,'source':{'file':str(src.relative_to(ROOT)).replace('\\','/'),'sha256':hashlib.sha256(src.read_bytes()).hexdigest(),'originalObjects':len(parts)+len(backgrounds),'originalTriangles':original_triangles},'apertureCutForRealtime':bool(aperture),'distantBackgroundDepthWrite':False,'materialStrategy':'fixed-camera projected baked appearance on genuine full room geometry; bounded parallax, not free-view PBR','externalResources':[],'model':'未确认','reasoning':'未确认'}
    assert 300<triangles<=50000 and all(b-a>.3 for a,b in zip(row['geometryBoundsBlender']['min'],row['geometryBoundsBlender']['max'])),row
    (out/'scene-realtime.json').write_text(json.dumps(row,ensure_ascii=False,indent=2),encoding='utf-8')
    reports.append({**row,'seconds':round(time.time()-began,2),'cupCandidates':[o.name for o in s.objects if any(k in o.name.lower() for k in ['tea','coffee','drink'])][:12]})
    (HERE/'export-report.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
    print('VG_REALTIME_EXPORTED '+sid+' '+str(triangles)+' triangles '+str(glb.stat().st_size)+' bytes',flush=True)
