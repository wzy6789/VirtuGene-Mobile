"""Project-owned fixed-view volumetric scene meshes aligned to licensed generated art.

This is explicitly a depth scene with projected image appearance, not a claimed
Cycles render of the reference. Physical solids and window framing supply real
depth; small movement only, no freely navigable PBR. Source art stays untouched.
"""
import bpy,math,json,sys,hashlib
from pathlib import Path
from mathutils import Vector
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
args=sys.argv[sys.argv.index('--')+1:];sid=args[0] if args else 'guofeng-tea-room'
art=json.loads((HERE/(sid+'-art.json')).read_text('utf8'));width,height=art['width'],art['height'];aspect=width/height
out=ROOT/'src/assets/chat-scenes'/sid;out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True);s=bpy.context.scene
fov=math.radians(60);tan=math.tan(fov/2)
def point(u,v,depth):return Vector(((u-.5)*2*tan*aspect*depth,depth,(.5-v)*2*tan*depth))
def solid(name,polygon,depth,thickness=.07):
    verts=[point(x,y,d) for d in [depth,depth+thickness] for x,y in polygon];n=len(polygon)
    faces=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(name,me);s.collection.objects.link(o);return o
def rect(name,x0,y0,x1,y1,depth,thickness=.07):return solid(name,[(x0,y0),(x1,y0),(x1,y1),(x0,y1)],depth,thickness)
def ellipse(name,cx,cy,rx,ry,depth,thickness=.1,n=24):return solid(name,[(cx+rx*math.cos(i*math.tau/n),cy+ry*math.sin(i*math.tau/n)) for i in range(n)],depth,thickness)
def branch(name,points,radius=.007):
    curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.bevel_depth=radius;curve.bevel_resolution=2;sp=curve.splines.new('POLY');sp.points.add(len(points)-1)
    for p,(x,y,d) in zip(sp.points,points):p.co=(*point(x,y,d),1)
    o=bpy.data.objects.new(name,curve);s.collection.objects.link(o);return o

if sid=='guofeng-tea-room':
    window=(.518,.264,1.012,.568);D=9.8
    rect('Warm silk plaster left wall',-.08,.15,.518,1.02,D+.3,.20)
    rect('Quiet plaster above lintel',-.08,-.08,1.08,.265,D+.3,.20)
    rect('Plaster below the tea window',.518,.568,1.08,1.03,D+.3,.20)
    rect('Walnut window left jamb',.505,.2,.528,.585,D-.12,.14)
    rect('Walnut window sill',.515,.554,1.05,.577,D-.16,.20)
    rect('Bamboo blind header',.504,.207,1.03,.303,D-.28,.09)
    for x in [.55,.64,.70,.84,.90,.98]:rect('Fine lattice vertical',x,.303,x+.008,.558,D-.10,.06)
    for y in [.319,.368,.486,.531]:rect('Fine lattice horizontal',.52,y,1.03,y+.007,D-.10,.06)
    rect('Unprinted silk scroll body',.201,.254,.395,.483,8.95,.04)
    for y in [.252,.481]:rect('Turned scroll roller',.19,y,.405,y+.007,8.85,.06)
    # Distinct furniture solids: back, carved frame, cushion, arms, legs and table.
    solid('Timber tea chair back',[(.07,.514),(.58,.512),(.68,.555),(.66,.655),(.06,.658)],6.30,.24)
    ellipse('Linen back cushion',.32,.578,.245,.065,6.0,.3)
    rect('Woven seat cushion',.09,.633,.705,.664,5.65,.42)
    rect('Low timber seat rail',.08,.664,.77,.683,5.7,.32)
    for x,y in [(.073,.526),(.712,.554)]:rect('Ming chair arm post',x,y,x+.017,.675,5.55,.14)
    rect('Right chair arm rail',.585,.549,.739,.566,5.42,.13)
    rect('Chair left rail',.057,.519,.15,.533,5.42,.13)
    for x in [.11,.696]:rect('Chair leg',x,.679,x+.018,.717,5.85,.16)
    # Near top surface has volume; the front edge remains a separate occluder.
    solid('Walnut tea table slab',[(-.08,.691),(1.08,.687),(1.08,.973),(-.08,.985)],3.3,.22)
    rect('Thread bound poetry volume',.65,.758,.97,.842,3.16,.045)
    ellipse('Celadon gaiwan saucer',.23,.778,.155,.024,3.09,.025)
    solid('Celadon lidded tea vessel',[(.115,.727),(.316,.727),(.291,.777),(.151,.777)],2.98,.15)
    ellipse('Gaiwan porcelain lid',.218,.729,.111,.012,2.96,.025)
    ellipse('Gaiwan lid knob',.216,.711,.033,.009,2.91,.025)
    rect('Paper lantern diffuser',.004,.378,.117,.481,6.6,.19)
    for x in [.005,.113]:rect('Lantern timber frame',x,.376,x+.007,.489,6.4,.1)
    for y in [.376,.475]:rect('Lantern crossbar',0,y,.128,y+.006,6.4,.1)
    for x in [.02,.105]:rect('Lantern foot',x,.48,x+.007,.602,6.5,.1)
    # Sparse actual bamboo stems outside the opening produce occasional weather occlusion.
    for i,x in enumerate([.59,.72,.87,.96]):
        branch('Courtyard bamboo',[(x,.565,12+i*.1),(x-.018,.43,12+i*.1),(x+.01,.29,12+i*.1)],.010)
        for j in range(3):
            y=.35+j*.065;branch('Bamboo leaf stalk',[(x,y,12),(x+.05,y-.025,12)],.007)
    effect=[point(window[0],window[3],D+.12),point(window[2],window[3],D+.12),point(window[2],window[1],D+.12),point(window[0],window[1],D+.12)]
    cup=point(.22,.706,2.90);light=point(.07,.425,6.3)
else:
    window=(.455,.199,1.015,.744);D=10.1
    rect('Apartment left plaster wall',-.08,-.08,.385,1.08,D+.25,.18)
    solid('Apartment diagonal lintel',[(.385,-.08),(1.08,-.08),(1.08,.117),(.385,.207)],D+.25,.18)
    solid('Apartment sill lower wall',[(.385,.731),(1.08,.785),(1.08,1.08),(.385,1.08)],D+.25,.18)
    rect('Bronze window near upright',.495,.184,.548,.747,D-.12,.13)
    rect('Bronze window far upright',.383,.205,.407,.730,D-.08,.10)
    solid('Sloping lower window rail',[(.39,.728),(1.04,.757),(1.04,.775),(.39,.743)],D-.10,.12)
    solid('Middle window rail',[(.48,.614),(1.04,.638),(1.04,.652),(.48,.628)],D-.1,.12)
    solid('Comfortable armchair back',[(.04,.565),(.464,.550),(.528,.621),(.527,.737),(.04,.763)],6.15,.4)
    ellipse('Woven olive cushion',.288,.630,.186,.060,5.80,.25)
    rect('Chair seat cushion',.21,.704,.61,.768,5.65,.35)
    solid('Right chair upholstered arm',[(.51,.619),(.71,.632),(.747,.663),(.748,.802),(.68,.825),(.59,.762)],5.55,.3)
    solid('Left chair upholstered arm',[(.046,.625),(.23,.658),(.26,.777),(.05,.799)],5.55,.25)
    solid('Walnut foreground coffee table',[(-.08,.784),(.18,.765),(1.08,.858),(1.08,1.05),(-.08,1.05)],3.3,.18)
    ellipse('Tea cup saucer',.18,.868,.15,.021,3.06,.025)
    solid('Open ceramic tea cup',[(.098,.812),(.285,.812),(.275,.868),(.121,.868)],2.99,.14)
    ellipse('Visible tea surface',.19,.815,.096,.012,2.98,.02)
    solid('Worn closed cloth book',[(.54,.872),(.83,.837),(.994,.906),(.69,.942)],3.16,.035)
    rect('Warm linen lamp shade',-.02,.401,.15,.475,6.7,.2)
    rect('Slim floor lamp stem',.029,.477,.037,.580,6.8,.06)
    effect=[point(window[0],window[3],D+.12),point(window[2],window[3],D+.12),point(window[2],window[1],D+.12),point(window[0],window[1],D+.12)]
    cup=point(.19,.810,2.99);light=point(.06,.435,6.5)
# A distant panel preserves the complete art while contributing no occlusion depth.
background=rect('VG_BAKED_DISTANT_BACKGROUND',-.15,-.15,1.15,1.15,25,.02)
objects=[o for o in s.objects if o!=background]
for o in objects:
    if o.type=='CURVE':bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False)
bpy.ops.object.select_all(action='DESELECT')
for o in objects:o.select_set(True)
bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();room=bpy.context.object;room.name='VG_ORIGINAL_ROOM_GEOMETRY'
tri=room.modifiers.new('Stable triangle topology','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=tri.name)
bpy.ops.object.camera_add(location=(0,0,0));cam=bpy.context.object;cam.name='FIXED_PORTRAIT_ART_CAMERA';cam.rotation_euler=(math.pi/2,0,0);cam.data.type='PERSP';cam.data.sensor_fit='VERTICAL';cam.data.sensor_height=36;cam.data.lens=36/(2*tan);cam.data.clip_start=.05;cam.data.clip_end=60;s.camera=cam
s.render.resolution_x=width;s.render.resolution_y=height;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG'
bpy.context.view_layer.update();bpy.ops.object.select_all(action='DESELECT');room.select_set(True);background.select_set(True);cam.select_set(True)
source=HERE/(sid+'-depth.blend');bpy.ops.wm.save_as_mainfile(filepath=str(source))
glb=out/'scene.glb';bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_cameras=True,export_lights=False,export_materials='NONE',export_yup=True,export_normals=True,export_texcoords=False,export_animations=False)
convert=lambda p:[round(p.x,6),round(p.z,6),round(-p.y,6)]
room.data.calc_loop_triangles();background.data.calc_loop_triangles()
positions=[v.co for v in room.data.vertices];meta={'schema':1,'sceneId':sid,'file':'scene.glb','bytes':glb.stat().st_size,'sha256':hashlib.sha256(glb.read_bytes()).hexdigest(),'triangles':len(room.data.loop_triangles)+len(background.data.loop_triangles),'vertices':len(room.data.vertices)+len(background.data.vertices),'drawCalls':2,'geometryBoundsBlender':{'min':[min(v[a] for v in positions) for a in range(3)],'max':[max(v[a] for v in positions) for a in range(3)]},'effectQuad':[convert(p) for p in effect],'lightPoint':convert(light),'cup':convert(cup),'camera':{'verticalFovDegrees':60},'materialStrategy':'Generated photographic art projected on independently authored volumetric depth geometry; fixed-view bounded parallax. Not original Cycles baking or a freely navigable PBR room.','source':{'file':str(source.relative_to(ROOT)).replace('\\','/'),'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'art':art},'externalResources':[],'model':'未确认','reasoning':'未确认'}
ambient_origin=point(.04,.75,5.0)
meta['ambientVolume']={'origin':convert(ambient_origin),'across':convert(point(.96,.75,5.0)-ambient_origin),'up':convert(point(.04,.34,5.0)-ambient_origin),'depth':[0,0,-2.0]}
(out/'scene-realtime.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf8')
# Semantic effect mask rendered against the real room, at native art size.
s.render.engine='BLENDER_EEVEE_NEXT';s.render.film_transparent=False;s.view_settings.view_transform='Standard';s.view_settings.look='None';s.view_settings.exposure=0
s.world=bpy.data.worlds.new('Black mask world');s.world.use_nodes=True;s.world.node_tree.nodes.get('Background').inputs[0].default_value=(0,0,0,1)
def emission(color):
    m=bpy.data.materials.new('Geometry visibility');m.use_nodes=True;n=m.node_tree.nodes;n.clear();e=n.new('ShaderNodeEmission');e.inputs[0].default_value=(*color,1);o=n.new('ShaderNodeOutputMaterial');m.node_tree.links.new(e.outputs[0],o.inputs[0]);return m
black=emission((0,0,0));white=emission((1,1,1));room.data.materials.append(black);background.hide_render=True
me=bpy.data.meshes.new('True window opening');me.from_pydata(effect,[],[(0,1,2,3)]);me.update();o=bpy.data.objects.new('Semantic weather volume front',me);s.collection.objects.link(o);o.data.materials.append(white)
s.render.filepath=str(HERE/(sid+'-window-mask.png'));bpy.ops.render.render(write_still=True)
print('VG_LIVED_IN_DEPTH_COMPLETE '+sid+' '+str(meta['triangles']),flush=True)
