"""Original fixed-camera bedroom and morning family living room. No imported assets.

Blender 4.5.3: --scene hearth-cabin|night-train --preview|--export|--source|--mask
Every runtime layer uses the exact same camera and physical geometry. The
composite poster is exported separately by export-runtime.py, never duplicated
behind independent foreground objects. GPU Cycles is an offline authoring tool.
"""
import bpy, math, json, sys, random
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
from pathlib import Path

HERE=Path(__file__).resolve().parent
ARGS=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
SID=ARGS[ARGS.index('--scene')+1] if '--scene' in ARGS else 'home-bedroom'
PREVIEW='--preview' in ARGS; SOURCE='--source' in ARGS
W,H=(450,1000) if PREVIEW else ((2160,4800) if SOURCE else (1440,3200))
OUT=HERE/SID; OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
S=bpy.context.scene; S.render.engine='CYCLES'
S.cycles.samples=16 if PREVIEW else (32 if SOURCE else 24)
S.cycles.use_denoising=True;S.cycles.use_adaptive_sampling=True
S.cycles.adaptive_threshold=.04
S.cycles.denoiser='OPTIX';S.cycles.denoising_use_gpu=True
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='OPTIX';prefs.get_devices()
    for d in prefs.devices:d.use=d.type=='OPTIX'
    S.cycles.device='GPU'
except Exception:S.cycles.device='CPU'
if '--cpu' in ARGS:S.cycles.device='CPU'
S.render.threads_mode='FIXED';S.render.threads=6
S.render.resolution_x=W;S.render.resolution_y=H;S.render.resolution_percentage=100
S.render.image_settings.file_format='PNG';S.render.image_settings.color_mode='RGBA'
S.view_settings.view_transform='AgX';S.view_settings.look='AgX - Medium High Contrast'
S.view_settings.exposure=.6 if SID=='hearth-cabin' else .85
S.world=bpy.data.worlds.new('Original ambient');S.world.use_nodes=True
world=S.world.node_tree.nodes.get('Background')
world.inputs['Color'].default_value=(.15,.19,.27,1) if SID=='hearth-cabin' else (.025,.045,.09,1)
world.inputs['Strength'].default_value=.16 if SID=='hearth-cabin' else .10
GROUPS={n:[] for n in ['base','casing','foreground','table']};rng=random.Random(1935)

def mat(name,c,rough=.6,metal=0,emission=0,noise=None,scale=7,grain=(1,1,1)):
    m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*c,1)
    n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    if emission:p.inputs['Emission Color'].default_value=(*c,1);p.inputs['Emission Strength'].default_value=emission
    if noise:
        coord=n.new('ShaderNodeTexCoord');mp=n.new('ShaderNodeMapping');mp.inputs['Scale'].default_value=grain
        tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=scale;tex.inputs['Detail'].default_value=3
        ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(*c,1);ramp.color_ramp.elements[1].color=(*noise,1)
        l.new(coord.outputs['Generated'],mp.inputs['Vector']);l.new(mp.outputs['Vector'],tex.inputs['Vector']);l.new(tex.outputs['Fac'],ramp.inputs['Fac']);l.new(ramp.outputs['Color'],p.inputs['Base Color'])
        bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.16;bump.inputs['Distance'].default_value=.015
        l.new(tex.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs['Normal'],p.inputs['Normal'])
    return m
def record(o,name,m,g='base'):
    o.name=name;o.data.materials.append(m);GROUPS[g].append(o);return o
def box(name,loc,size,m,g='base',b=.025):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    record(o,name,m,g)
    if b:
        mod=o.modifiers.new('Tactile softened edges','BEVEL');mod.width=b;mod.segments=4;o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
    return o
def cyl(name,loc,r,d,m,g='base',v=64):
    bpy.ops.mesh.primitive_cylinder_add(vertices=v,radius=r,depth=d,location=loc);o=record(bpy.context.object,name,m,g)
    mod=o.modifiers.new('Soft turned edge','BEVEL');mod.width=.008;mod.segments=3;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');return o
def curve(name,pts,r,m,g='base'):
    c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.bevel_depth=r;c.bevel_resolution=3;s=c.splines.new('BEZIER');s.bezier_points.add(len(pts)-1)
    for p,v in zip(s.bezier_points,pts):p.co=v;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,c);S.collection.objects.link(o);return record(o,name,m,g)
def sphere(name,loc,scale,m,g='base'):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=16,location=loc);o=record(bpy.context.object,name,m,g);o.scale=scale
    for p in o.data.polygons:p.use_smooth=True
    return o
def area(name,loc,target,power,color,size):
    bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;o.data.energy=power;o.data.color=color;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();return o
def cup(x,y,z,m,coffee,group='table'):
    cyl('Cup saucer',(x,y,z+.018),.18,.025,m,group,96)
    profile=[(.09,z+.035),(.116,z+.045),(.125,z+.18),(.122,z+.205),(.109,z+.205),(.105,z+.18),(.099,z+.055)]
    vs=[];fs=[];N=96
    for r,h in profile:
        for i in range(N):a=math.tau*i/N;vs.append((x+r*math.cos(a),y+r*math.sin(a),h))
    for j in range(len(profile)-1):
        for i in range(N):fs.append((j*N+i,j*N+(i+1)%N,(j+1)*N+(i+1)%N,(j+1)*N+i))
    me=bpy.data.meshes.new('Original open ceramic vessel');me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new('Single open tea cup',me);S.collection.objects.link(o);record(o,o.name,m,group)
    for p in me.polygons:p.use_smooth=True
    cyl('Drink surface inside cup',(x,y,z+.186),.106,.005,coffee,group,96)
    curve('Cup handle',[(x-.1,y,z+.18),(x-.18,y,z+.19),(x-.19,y,z+.08),(x-.11,y,z+.07)],.016,m,group)
    return (x,y,z+.205)

wood=mat('Smoked oak grain',(.085,.035,.015),.44,noise=(.27,.13,.055),scale=5,grain=(1,45,2))
lightwood=mat('Honey timber grain',(.16,.073,.026),.5,noise=(.42,.24,.10),scale=5,grain=(1,35,1))
brass=mat('Antique satin brass',(.36,.22,.07),.3,.72)
black=mat('Blackened iron',(.014,.016,.02),.42,.5)
cream=mat('Handthrown cream ceramic',(.66,.59,.44),.3)
coffee=mat('Hot dark tea',(.065,.025,.008),.25)
paper=mat('Uncoated paper',(.64,.58,.44),.9)

"""Original domestic room geometry, executed after the shared project-owned Blender primitives."""
plaster=mat('Warm ivory mineral plaster',(.48,.43,.36),.92,noise=(.63,.58,.50),scale=35)
linen=mat('Natural woven ivory linen',(.57,.51,.42),.97,noise=(.76,.70,.60),scale=155)
sage=mat('Soft sage woven cotton',(.22,.28,.22),.98,noise=(.37,.44,.33),scale=150)
rose=mat('Muted clay rose cotton',(.31,.20,.17),.96,noise=(.46,.32,.26),scale=150)
rugmat=mat('Soft oatmeal tufted rug',(.37,.32,.25),.98,noise=(.57,.51,.41),scale=170)
glow=mat('Frosted warm lamp diffuser',(1,.73,.39),.78,0,1.25)
CUP=None
box('Continuous pale oak floor',(0,1,-.075),(8,16,.15),lightwood,b=.003)
for x in [i*.30-4 for i in range(28)]:box('Narrow floor plank joint',(x,1,.002),(.004,16,.003),wood,b=0)
box('Quiet back plaster wall',(0,3.7,2.0),(7,.18,4),plaster)
box('Soft left room wall',(-3.2,0,2.0),(.16,8,4),plaster)
box('Ivory ceiling',(0,0,4.02),(7,8,.12),plaster)
box('Oak skirting board',(0,3.52,.07),(6.5,.07,.12),wood,b=.008)

def curtain(name,x,y,z,width,height,material,group='foreground'):
    vs=[];fs=[];nx,nz=48,40
    for j in range(nz+1):
        t=j/nz
        for i in range(nx+1):
            u=i/nx;vs.append((x+(u-.5)*width,y+.065*math.sin(u*math.tau*6),z-t*height+.025*math.cos(u*math.tau*6)*t))
    for j in range(nz):
        for i in range(nx):a=j*(nx+1)+i;fs.append((a,a+1,a+nx+2,a+nx+1))
    me=bpy.data.meshes.new(name+' folded fabric');me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new(name,me);S.collection.objects.link(o);record(o,name,material,group)
    solid=o.modifiers.new('Actual woven cloth thickness','SOLIDIFY');solid.thickness=.006
    for p in me.polygons:p.use_smooth=True

if SID=='home-bedroom':
    S.view_settings.exposure=.55
    world.inputs['Color'].default_value=(.13,.17,.25,1);world.inputs['Strength'].default_value=.16
    blue=mat('Quiet blue evening sky',(.027,.055,.11),.9,0,.22)
    box('Evening window open view',(1.71,3.54,2.1),(1.68,.028,2.0),blue,b=.015)
    for x in [.80,2.62]:box('Bedroom oak window jamb',(x,3.42,2.1),(.13,.21,2.16),wood,'casing',.012)
    for z in [1.05,3.15]:box('Bedroom window sill',(1.71,3.40,z),(1.94,.25,.12),lightwood,'casing',.014)
    box('Bedroom window central mullion',(1.71,3.39,2.1),(.04,.14,1.95),wood,'casing',.005)
    curtain('Soft side curtain',2.47,3.19,3.33,.55,2.65,linen)
    # A real low bed, padded headboard and independently stitched duvet.
    box('Walnut bed platform',(-.59,.90,.29),(2.35,3.48,.38),wood,b=.09)
    for x in [-1.56,.39]:
        for y in [-.50,2.30]:box('Bed solid oak foot',(x,y,.14),(.12,.14,.28),wood,b=.022)
    box('Thick rounded linen mattress',(-.59,.90,.62),(2.27,3.31,.35),linen,b=.15)
    box('Soft upholstered headboard',(-.59,2.65,1.14),(2.55,.19,1.35),sage,b=.15)
    for x in [-1.16,-.03]:
        p=box('Plump sleeping pillow',(x,2.02,.89),(.94,.60,.22),linen,b=.14);p.rotation_euler[2]=.035 if x<-.5 else -.035
        box('Hand sewn pillow welt',(x,2.02,.89),(.955,.615,.16),paper,b=.077)
        box('Pillow soft upper face',(x,2.02,.935),(.91,.575,.15),linen,b=.12)
    # Gently wrinkled duvet, with an actual soft fall at the foot of the bed.
    vs=[];fs=[];nx,ny=52,76
    for j in range(ny+1):
        v=j/ny;y=1.65-v*2.73
        for i in range(nx+1):
            u=i/nx;x=-.59+(u-.5)*2.30;edge=max(0,(abs(u-.5)-.42)/.08)
            z=.846-.16*edge**1.3-.24*max(0,(v-.85)/.15)**1.2+.015*math.sin(u*math.tau*7+v*3)+.009*math.cos(v*math.tau*8+u*5)
            vs.append((x,y,z))
    for j in range(ny):
        for i in range(nx):a=j*(nx+1)+i;fs.append((a,a+1,a+nx+2,a+nx+1))
    me=bpy.data.meshes.new('Original wrinkled duvet');me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new('Draped sage cotton duvet',me);S.collection.objects.link(o);record(o,o.name,sage)
    for p in me.polygons:p.use_smooth=True
    thick=o.modifiers.new('Padded duvet edge','SOLIDIFY');thick.thickness=.035
    curtain('Clay rose folded foot throw',-.59,-.82,.94,2.22,.48,rose)
    # The bedside nightstand is a complete contact group; no pretend hot cup.
    box('Oak bedside cabinet',(1.10,1.68,.45),(.78,.78,.82),wood,'table',.045)
    box('Nightstand drawer front',(1.10,1.272,.52),(.70,.035,.29),lightwood,'table',.014)
    curve('Small brass drawer handle',[(1.0,1.24,.51),(1.20,1.24,.51)],.012,brass,'table')
    cyl('Bedside lamp ceramic foot',(1.14,1.69,.90),.16,.065,cream,'table')
    cyl('Bedside lamp slender brass stem',(1.14,1.69,1.09),.022,.36,brass,'table')
    bpy.ops.mesh.primitive_cone_add(vertices=96,radius1=.27,radius2=.16,depth=.37,location=(1.14,1.69,1.34));record(bpy.context.object,'Warm linen bedside lampshade',glow,'table')
    book=box('Closed bedside poetry book',(.98,1.43,.90),(.31,.40,.035),rose,'table',.008);book.rotation_euler[2]=.13
    cyl('Bedroom low woven pouf',(-1.86,-1.20,.24),.42,.43,linen,'foreground')
    rug=cyl('Bedroom soft rounded rug',(-.2,-.1,.012),1.9,.024,rugmat,v=128);rug.scale=(1,1.5,1)
    # Wall art is original geometry, not a downloaded texture.
    box('Oak picture frame',(-.78,3.53,2.70),(.74,.06,.93),wood,b=.012)
    box('Unprinted warm picture mat',(-.78,3.49,2.70),(.64,.016,.83),paper,b=.004)
    sphere('Simple quiet terracotta art disc',(-.78,3.475,2.78),(.19,.008,.19),rose)
    area('Actual bedside warm light',(1.14,1.64,1.31),(-.5,.5,.8),100,(1,.59,.27),.40)
    area('Bedside reflected wall bounce',(1.45,1.9,1.8),(-.1,2.8,1.3),90,(1,.72,.45),1.5)
    area('Bedroom moon window',(1.7,3.14,2.4),(-.5,.7,.5),85,(.42,.60,1),1.7)
    area('Soft sleeping room fill',(0,-3,2.5),(0,1,1),105,(1,.76,.54),4)
    TARGET=(0,1.25,1.4);CAMLOC=(.08,-6.1,2.50);LENS=31
    EFFECT=[(.89,3.49,1.13),(2.53,3.49,1.13),(2.53,3.49,3.07),(.89,3.49,3.07)]
    LIGHT=(1.14,1.69,1.34);EFFECT_AREA='window'
else:
    S.view_settings.exposure=.35
    world.inputs['Color'].default_value=(.50,.60,.70,1);world.inputs['Strength'].default_value=.36
    sky=mat('Soft morning sky',(.50,.66,.75),.9,0,.22)
    box('Large morning garden view',(.63,3.54,2.17),(3.55,.022,2.08),sky,b=.015)
    for x in [-1.22,2.48]:box('Living oak window jamb',(x,3.41,2.17),(.15,.22,2.24),lightwood,'casing',.015)
    for z in [1.07,3.26]:box('Living broad window sill',(.63,3.39,z),(3.84,.35,.13),lightwood,'casing',.015)
    for x in [-.02,1.22]:box('Living window mullion',(x,3.4,2.17),(.045,.14,2.0),wood,'casing',.005)
    garden=mat('Garden olive leaves',(.12,.22,.13),.95,noise=(.23,.35,.18),scale=18)
    for i in range(9):sphere('Distant garden crown',(-1.02+i*.39,3.505,1.31+rng.random()*.3),(.30,.025,.22),garden)
    curtain('Left living linen curtain',-1.30,3.11,3.40,.62,2.90,linen)
    curtain('Right living linen curtain',2.43,3.11,3.40,.62,2.90,linen)
    # Broad domestic sofa, distinct from single cafe chair or cabin wingback.
    box('Sofa oak floating frame',(-.05,1.36,.30),(2.96,1.19,.28),wood,b=.07)
    box('Long upholstered linen sofa back',(-.05,1.89,.92),(3.05,.26,.94),linen,b=.14)
    for x in [-.77,.67]:box('Sofa seat cushion',(x,1.25,.57),(1.38,1.05,.30),linen,b=.13)
    for x in [-1.62,1.52]:box('Sofa soft rolled arm',(x,1.32,.70),(.25,1.23,.61),linen,b=.12)
    for x in [-1.30,1.20]:
        for y in [.92,1.74]:box('Sofa turned oak foot',(x,y,.12),(.095,.095,.24),wood,b=.018)
    for x,m in [(-1.02,sage),(.94,rose)]:
        p=box('Domestic woven sofa pillow',(x,1.56,.87),(.57,.20,.53),m,b=.12);p.rotation_euler[1]=.13 if x<0 else -.13
    box('Low closed storage cabinet',(-2.32,2.20,.56),(.72,1.16,1.08),lightwood,b=.035)
    for z in [.33,.69]:box('Storage drawer line',(-2.32,1.60,z),(.65,.014,.018),wood,b=.004)
    cyl('Ceramic pot on cabinet',(-2.31,2.15,1.22),.16,.27,cream)
    for i in range(7):
        a=i*2.4;curve('Houseplant slender stem',[(-2.31,2.15,1.32),(-2.31+.22*math.cos(a),2.15+.13*math.sin(a),1.75+.13*(i%3))],.009,garden)
        sphere('Broad original houseplant leaf',(-2.31+.22*math.cos(a),2.15+.13*math.sin(a),1.75+.13*(i%3)),(.13,.045,.07),garden)
    rug=cyl('Living room thick oval rug',(.0,-.33,.019),1.83,.033,rugmat,v=128);rug.scale=(1.12,1.35,1)
    # Complete coffee table and contact group, ceramic tea and everyday book.
    cyl('Near low round oak coffee table',(.08,-1.20,.58),.88,.075,lightwood,'table',128)
    for a in [0,2.1,4.2]:box('Coffee table splayed leg',(.08+.47*math.cos(a),-1.20+.47*math.sin(a),.28),(.085,.085,.56),wood,'table',.018)
    CUP=cup(-.20,-1.29,.63,cream,coffee)
    book=box('Living room linen book',(.47,-1.04,.66),(.40,.48,.045),sage,'table',.008);book.rotation_euler[2]=-.15
    box('Book paper block',(.47,-1.04,.664),(.385,.465,.021),paper,'table',.004).rotation_euler[2]=-.15
    # Woven foreground basket with folded blanket, not another cafe plant.
    cyl('Foreground linen storage basket',(-1.51,-1.18,.30),.36,.57,rugmat,'foreground',96)
    for z in [.08,.16,.24,.32,.40,.48,.56]:curve('Basket fine wicker weave',[(-1.51+.365*math.cos(i*math.tau/64),-1.18+.365*math.sin(i*math.tau/64),z) for i in range(65)],.006,wood,'foreground')
    box('Blanket folded over basket rim',(-1.50,-1.21,.60),(.58,.53,.11),sage,'foreground',.045)
    area('Broad domestic morning window',(.7,3.0,2.6),(0,-1,.8),750,(1,.88,.67),3.6)
    area('Soft domestic room bounce',(-1.0,-3,3.0),(0,1,1),160,(.83,.90,1),4)
    TARGET=(0,1.30,1.45);CAMLOC=(.12,-6.7,2.48);LENS=30
    EFFECT=[(-1.13,3.49,1.15),(2.40,3.49,1.15),(2.40,3.49,3.18),(-1.13,3.49,3.18)]
    LIGHT=(.6,3.1,2.6);EFFECT_AREA='window'

bpy.ops.object.camera_add(location=CAMLOC);CAM=bpy.context.object;CAM.name=SID.upper()+'_FIXED_PORTRAIT'
CAM.rotation_euler=(Vector(TARGET)-CAM.location).to_track_quat('-Z','Y').to_euler();CAM.data.lens=LENS;CAM.data.sensor_fit='VERTICAL';CAM.data.sensor_height=36;CAM.data.clip_start=.1;CAM.data.clip_end=100;S.camera=CAM
bpy.context.view_layer.update()
def project(p):
    v=world_to_camera_view(S,CAM,Vector(p));return [round(v.x*1440,3),round((1-v.y)*3200,3)]
def visible(groups):
    for g,objects in GROUPS.items():
        for o in objects:o.hide_render=False;o.visible_camera=g in groups
def render(path,transparent=False):
    S.render.film_transparent=transparent;S.render.filepath=str(path);bpy.ops.render.render(write_still=True)
def flat(name,color):
    m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;n.clear();e=n.new('ShaderNodeEmission');e.inputs['Color'].default_value=(*color,1);e.inputs['Strength'].default_value=1;o=n.new('ShaderNodeOutputMaterial');m.node_tree.links.new(e.outputs[0],o.inputs['Surface']);return m

metadata={'schema':1,'sceneId':SID,'designWidth':1440,'designHeight':3200,'camera':{'location':list(CAM.location),'rotation':list(CAM.rotation_euler),'lens':LENS,'sensorFit':'VERTICAL','sensorHeight':36},'windowPolygon':[project(p) for p in EFFECT],'effectArea':EFFECT_AREA,'lightCenter':project(LIGHT),'layers':['base','casing','foreground','table'],'provenance':'Original procedural Blender geometry and shaders, offline Cycles render, no imported stock or generated imagery.'}
if CUP:metadata['cupMouth']=project(CUP)
lc=metadata['lightCenter'];metadata['lightRect']=[round(lc[0]-350),round(lc[1]-450),700,900]
(OUT/'camera-export.json').write_text(json.dumps(metadata,indent=2),encoding='utf8')
if PREVIEW:
    visible(GROUPS);render(OUT/'preview.png')
elif '--mask' in ARGS:
    # Geometry-depth semantic visibility mask. The bright plane sits behind
    # actual frame, seat, logs, curtain, table and foreground occluders.
    S.cycles.samples=8;S.cycles.use_denoising=False;S.render.dither_intensity=0
    S.view_settings.view_transform='Standard';S.view_settings.look='None';S.view_settings.exposure=0;S.view_settings.gamma=1
    world.inputs['Strength'].default_value=0
    white=flat('Effect opening white',(1,1,1));blackmask=flat('Geometry occluder black',(0,0,0))
    for o in S.objects:
        if o.type=='LIGHT':o.data.energy=0
        elif o.type in ['MESH','CURVE']:o.hide_render=False;o.visible_camera=True;o.data.materials.clear();o.data.materials.append(blackmask)
    if SID=='hearth-cabin':
        # The opening backing is in front of the semantic plane. Hide this
        # solid opaque backboard only; all actual logs and guard remain.
        for o in S.objects:
            if o.name.startswith('Fireplace dark recessed opening'):o.hide_render=True
    me=bpy.data.meshes.new('Local effect opening geometry');me.from_pydata(EFFECT,[],[(0,1,2,3)]);me.update();o=bpy.data.objects.new('Local effect semantic plane',me);S.collection.objects.link(o);o.data.materials.append(white)
    render(OUT/'effect-occlusion-mask.png')
    o.hide_render=True
    # Separate casing visibility prevents the final frame overlay from
    # accidentally painting over a foreground chair/curtain silhouette.
    for ob in GROUPS['casing']:ob.data.materials.clear();ob.data.materials.append(white)
    render(OUT/'casing-occlusion-mask.png')
    for ob in GROUPS['casing']:ob.data.materials.clear();ob.data.materials.append(blackmask)
    for ob in GROUPS['foreground']:ob.data.materials.clear();ob.data.materials.append(white)
    render(OUT/'foreground-occlusion-mask.png')
    for ob in GROUPS['foreground']:ob.data.materials.clear();ob.data.materials.append(blackmask)
    for ob in GROUPS['table']:ob.data.materials.clear();ob.data.materials.append(white)
    render(OUT/'table-occlusion-mask.png')
elif SOURCE:
    visible(GROUPS);render(OUT/f'source-{SID}-2160.png')
else:
    visible(GROUPS);bpy.ops.wm.save_as_mainfile(filepath=str(OUT/f'VirtuGene-{SID}-Original.blend'))
    if '--metadata' not in ARGS:
        rend=OUT/'renders';rend.mkdir(exist_ok=True)
        for group in GROUPS:
            visible([group]);render(rend/(group+'.png'),transparent=group!='base')
