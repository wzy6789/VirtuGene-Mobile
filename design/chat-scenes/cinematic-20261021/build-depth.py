"""Original volumetric occluders for a fixed photographic scene, not a PBR reconstruction.

Run in a separate background Blender process; never touches the user's live scene.
"""
import bpy,math,json,sys,hashlib
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
sid=sys.argv[sys.argv.index('--')+1];cfg=json.loads((HERE/'rooms.json').read_text('utf8'))[sid]
art=json.loads((HERE/(sid+'-art.json')).read_text('utf8'));w,h=art['width'],art['height'];aspect=w/h
out=ROOT/'src/assets/chat-scenes'/sid;out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;tan=math.tan(math.pi/6)
def point(u,v,depth):return Vector(((u-.5)*2*tan*aspect*depth,depth,(.5-v)*2*tan*depth))
def solid(name,polygon,depth,thickness=.10):
    n=len(polygon);verts=[point(u,v,d) for d in [depth,depth+thickness] for u,v in polygon]
    faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update();obj=bpy.data.objects.new(name,mesh);scene.collection.objects.link(obj);return obj
def rect(name,x0,y0,x1,y1,depth,thickness=.1):return solid(name,[(x0,y0),(x1,y0),(x1,y1),(x0,y1)],depth,thickness)
def ellipse(name,cx,cy,rx,ry,depth,thickness=.06,n=64):return solid(name,[(cx+rx*math.cos(i*math.tau/n),cy+ry*math.sin(i*math.tau/n)) for i in range(n)],depth,thickness)
opening=cfg['opening'];x0=min(p[0] for p in opening);y0=min(p[1] for p in opening);y1=max(p[1] for p in opening)
rect('Opaque left room wall',-.12,-.12,x0,1.12,10.4,.20)
rect('Opaque wall below window',x0,y1,1.12,1.12,10.4,.20)
rect('Opaque wall above window',x0,-.12,1.12,y0,10.4,.20)
# Follow the photographed sloping aperture; a bounding rectangle leaves wedges
# of ceiling/sill unoccluded. These solids sit just in front of the glass plane.
solid('Sloping opaque ceiling',[(x0,-.12),(1.12,-.12),(1.12,opening[1][1]),opening[1],opening[0],(x0,opening[0][1])],10.0,.12)
lower=opening[2:]
if lower[-1][1]<.2:lower=lower[:-1]
solid('Opaque wall under sloping sill',lower+[(x0,1.12),(1.12,1.12)],10.0,.12)
for row in cfg['furniture']:solid(row['name'],row['polygon'],row['depth'],row['thickness'])
# The cup, handle, saucer and lamp are independent rounded depth volumes.
cx,cy=cfg['cup'];lx,ly=cfg['lamp']
ellipse('Ceramic tea surface',cx,cy+.008,.093,.013,2.94,.015)
solid('Handmade ceramic cup body',[(cx-.095,cy+.005),(cx+.093,cy+.005),(cx+.078,cy+.070),(cx-.077,cy+.070)],2.97,.14)
ellipse('Ceramic cup bottom',cx,cy+.069,.077,.011,2.95,.035)
ellipse('Cup handle front',cx-.104,cy+.040,.026,.028,2.91,.055)
ellipse('Earthenware saucer',cx,cy+.083,.118,.019,3.08,.028)
ellipse('Lamp shade top',lx,ly-.040,.080,.013,6.45,.10)
ellipse('Lamp shade lower rim',lx,ly+.024,.096,.016,6.40,.10)
ellipse('Lamp pottery base',lx,ly+.067,.046,.043,6.37,.14)
if sid=='moonlit-bedroom':
    for i in range(9):rect('Curtain fold depth',.88+i*.016,-.03,.884+i*.016,.63,8.36+(i%2)*.04,.04)
else:
    ellipse('Soft lumbar cushion',.21,.604,.14,.047,5.6,.16)
    ellipse('Lounge seat edge',.32,.70,.24,.022,5.7,.14)
background=rect('VG_BAKED_DISTANT_BACKGROUND',-.15,-.15,1.15,1.15,25,.02)
roomObjects=[o for o in scene.objects if o!=background]
bpy.ops.object.select_all(action='DESELECT')
for obj in roomObjects:obj.select_set(True)
bpy.context.view_layer.objects.active=roomObjects[0];bpy.ops.object.join();room=bpy.context.object;room.name='VG_ORIGINAL_ROOM_GEOMETRY'
tri=room.modifiers.new('Deterministic triangles','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=tri.name)
bpy.ops.object.camera_add(location=(0,0,0));camera=bpy.context.object;camera.name='FIXED_PORTRAIT_ART_CAMERA';camera.rotation_euler=(math.pi/2,0,0);camera.data.sensor_fit='VERTICAL';camera.data.sensor_height=36;camera.data.lens=36/(2*tan);camera.data.clip_start=.05;camera.data.clip_end=60;scene.camera=camera
scene.render.resolution_x=w;scene.render.resolution_y=h;scene.render.resolution_percentage=100
bpy.context.view_layer.update();bpy.ops.object.select_all(action='DESELECT');room.select_set(True);background.select_set(True);camera.select_set(True)
source=HERE/(sid+'-depth.blend');bpy.ops.wm.save_as_mainfile(filepath=str(source));glb=out/'scene.glb'
bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_cameras=True,export_lights=False,export_materials='NONE',export_yup=True,export_normals=True,export_texcoords=False,export_animations=False)
convert=lambda p:[round(p.x,6),round(p.z,6),round(-p.y,6)]
window=[min(p[0] for p in opening),min(p[1] for p in opening),max(p[0] for p in opening),max(p[1] for p in opening)];depth=10.05
effect=[point(window[0],window[3],depth),point(window[2],window[3],depth),point(window[2],window[1],depth),point(window[0],window[1],depth)]
room.data.calc_loop_triangles();background.data.calc_loop_triangles()
vertices=[v.co for v in room.data.vertices]
meta={'schema':1,'sceneId':sid,'file':'scene.glb','bytes':glb.stat().st_size,'sha256':hashlib.sha256(glb.read_bytes()).hexdigest(),'triangles':len(room.data.loop_triangles)+len(background.data.loop_triangles),'vertices':len(room.data.vertices)+len(background.data.vertices),'drawCalls':2,'geometryBoundsBlender':{'min':[min(v[c] for v in vertices) for c in range(3)],'max':[max(v[c] for v in vertices) for c in range(3)]},'effectQuad':[convert(p) for p in effect],'lightPoint':convert(point(lx,ly,6.3)),'cup':convert(point(cx,cy-.005,2.90)),'camera':{'verticalFovDegrees':60},'materialStrategy':'Generated native photographic-style art projected on original volumetric fixed-view depth geometry. Approximate window optics, not free-view PBR or ray-traced glass.','source':{'file':source.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'art':art},'externalResources':[],'model':'未确认','reasoning':'未确认'}
ambient=point(.04,.76,5.0);meta['ambientVolume']={'origin':convert(ambient),'across':convert(point(.96,.76,5.0)-ambient),'up':convert(point(.04,.34,5.0)-ambient),'depth':[0,0,-2.]}
(out/'scene-realtime.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf8')
# Black solids against a white window polygon generate the real compatibility mask.
try:scene.render.engine='BLENDER_EEVEE'
except TypeError:scene.render.engine='BLENDER_EEVEE_NEXT'
scene.render.film_transparent=False;scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0
scene.world=bpy.data.worlds.new('Black visibility world');scene.world.use_nodes=True;worldBg=next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND');worldBg.inputs[0].default_value=(0,0,0,1)
def emission(color):
    mat=bpy.data.materials.new('Visibility');mat.use_nodes=True;nodes=mat.node_tree.nodes;nodes.clear();em=nodes.new('ShaderNodeEmission');em.inputs[0].default_value=(*color,1);output=nodes.new('ShaderNodeOutputMaterial');mat.node_tree.links.new(em.outputs[0],output.inputs[0]);return mat
room.data.materials.append(emission((0,0,0)));background.hide_render=True
mesh=bpy.data.meshes.new('Window aperture');mesh.from_pydata([point(u,v,depth) for u,v in opening],[],[tuple(range(len(opening)))]);mesh.update();aperture=bpy.data.objects.new('Semantic glass opening',mesh);scene.collection.objects.link(aperture);aperture.data.materials.append(emission((1,1,1)))
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(HERE/(sid+'-window-mask.png'));bpy.ops.render.render(write_still=True)
print('VG_IMMERSIVE_DEPTH_COMPLETE',sid,meta['triangles'],flush=True)
