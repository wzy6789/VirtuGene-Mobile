"""Original VirtuGene cafe; Blender 4.5 headless authoring, no external assets.

All variants use the same physical geometry/camera. Transparent foregrounds
are rendered without the base geometry, then composited OFFLINE over a true
clean plate. This makes neutral poster/composite pixel-identical before WebP
compression and prevents duplicated cups, leaves or their contact shadows.
Run: blender -b --python design/chat-scenes/cafe/build-cafe.py -- --preview
Then: blender -b --python design/chat-scenes/cafe/build-cafe.py -- --export
"""
import bpy, math, json, sys, random
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
ARGS = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
PREVIEW = '--preview' in ARGS
SOURCE_NIGHT = '--source-night' in ARGS
WIDTH, HEIGHT = (450,1000) if PREVIEW else ((2160,4800) if '--source' in ARGS or SOURCE_NIGHT else (1440,3200))
RNG = random.Random(4619)
bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene
SCENE.render.engine = 'CYCLES'
SCENE.cycles.samples = 24 if PREVIEW else 40
SCENE.cycles.use_denoising = True
SCENE.cycles.use_adaptive_sampling = True
SCENE.render.resolution_x, SCENE.render.resolution_y = WIDTH, HEIGHT
SCENE.render.resolution_percentage = 100
SCENE.render.image_settings.file_format = 'PNG'
SCENE.render.image_settings.color_mode = 'RGBA'
SCENE.render.film_transparent = True
SCENE.view_settings.view_transform = 'AgX'
SCENE.view_settings.look = 'AgX - Medium High Contrast'
SCENE.view_settings.exposure = .3
SCENE.world = bpy.data.worlds.new('Cafe ambient')
SCENE.world.use_nodes = True
WORLD = SCENE.world.node_tree.nodes.get('Background')
WORLD.inputs[0].default_value = (.36,.47,.57,1)
WORLD.inputs[1].default_value = .4

GROUPS = {n:[] for n in ['base','table','plant','casing']}
MATS = {}

def mat(name, color, rough=.5, metal=0, emission=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=rough; p.inputs['Metallic'].default_value=metal
    if emission:
        p.inputs['Emission Color'].default_value=(*color,1); p.inputs['Emission Strength'].default_value=emission
    MATS[name]=m; return m

def noise_mat(name, c1, c2, scale=5, rough=.6, grain=None):
    m=mat(name,c1,rough); n=m.node_tree.nodes; l=m.node_tree.links
    tex=n.new('ShaderNodeTexNoise'); tex.inputs['Scale'].default_value=scale; tex.inputs['Detail'].default_value=3
    coord=n.new('ShaderNodeTexCoord'); mapping=n.new('ShaderNodeMapping')
    l.new(coord.outputs['Generated'],mapping.inputs['Vector'])
    mapping.inputs['Scale'].default_value=grain or (1,1,1)
    l.new(mapping.outputs['Vector'],tex.inputs['Vector'])
    ramp=n.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].color=(*c1,1); ramp.color_ramp.elements[1].color=(*c2,1)
    l.new(tex.outputs['Fac'],ramp.inputs['Fac']); l.new(ramp.outputs['Color'],n.get('Principled BSDF').inputs['Base Color'])
    bump=n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.12; bump.inputs['Distance'].default_value=.018
    l.new(tex.outputs['Fac'],bump.inputs['Height']); l.new(bump.outputs['Normal'],n.get('Principled BSDF').inputs['Normal'])
    return m

oak=noise_mat('Honey oak - fine real grain',(.095,.041,.015),(.36,.19,.075),6,.38,(1,45,2))
walnut=noise_mat('Oiled walnut',(.035,.019,.012),(.16,.085,.036),6,.34,(1,35,2))
plaster=noise_mat('Warm lime plaster',(.43,.38,.29),(.64,.59,.48),4,.9)
linen=noise_mat('Sage upholstered linen',(.085,.12,.105),(.17,.22,.18),80,.95)
stone=noise_mat('Soft pale terrazzo',(.33,.31,.27),(.54,.51,.44),25,.6)
black=mat('Oxidized bronze',(.028,.032,.027),.3,.65)
brass=mat('Brushed champagne brass',(.38,.245,.09),.27,.78)
ceramic=mat('Cream porcelain',(.75,.70,.57),.24)
coffee=mat('Dark espresso with crema',(.095,.041,.014),.22)
leafdark=mat('Rubber plant leaf green',(.025,.07,.033),.36)
leaflight=mat('Leaf veins',(.095,.17,.067),.42)
terracotta=noise_mat('Handmade clay pot',(.16,.064,.035),(.28,.12,.06),12,.85)
paper=mat('Book uncoated paper',(.63,.56,.42),.9)
amber=mat('Lamp glowing linen',(.9,.57,.26),.65,0,.8)
outside_wall=mat('Across street limestone',(.40,.39,.33),.93)
outside_trim=mat('Exterior charcoal joinery',(.05,.065,.065),.7)
outside_glass=mat('Distant cool windows',(.19,.27,.29),.24,.15)
street=mat('Outside pavement',(.16,.18,.18),.6)
lightbox=mat('Exterior warm window lights',(.72,.47,.23),.5,0,.1)

def record(o,name,material,group='base'):
    o.name=name; o.data.materials.append(material); GROUPS[group].append(o); return o

def box(name,loc,size,material,group='base',bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=bpy.context.object
    o.dimensions=size; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    record(o,name,material,group)
    if bevel:
        b=o.modifiers.new('Crafted rounded edges','BEVEL'); b.width=bevel; b.segments=3
        o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return o

def cylinder(name,loc,radius,depth,material,group='base',vertices=64):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=loc)
    o=record(bpy.context.object,name,material,group)
    b=o.modifiers.new('Soft turned rim','BEVEL'); b.width=.008; b.segments=3
    o.modifiers.new('Weighted normals','WEIGHTED_NORMAL'); return o

def curve(name,points,radius,material,group='base'):
    c=bpy.data.curves.new(name,'CURVE'); c.dimensions='3D'; c.bevel_depth=radius; c.bevel_resolution=3
    s=c.splines.new('BEZIER'); s.bezier_points.add(len(points)-1)
    for p,co in zip(s.bezier_points,points): p.co=co; p.handle_left_type='AUTO'; p.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,c); SCENE.collection.objects.link(o); return record(o,name,material,group)

def area(name,loc,target,power,color,size):
    bpy.ops.object.light_add(type='AREA',location=loc); o=bpy.context.object; o.name=name
    o.data.energy=power; o.data.color=color; o.data.shape='DISK'; o.data.size=size
    o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler(); return o

# Architectural envelope: a real narrow street-facing corner, not a flat UI void.
box('Continuous honey oak floor',(0,1,-.065),(7,13,.12),oak,bevel=.005)
for x in [i*.31-3.5 for i in range(24)]: box('Oak board shadow seam',(x,1,.003),(.006,13,.003),walnut,bevel=0)
box('Back plaster wall left of window',(-1.55,4.2,1.9),(3.2,.17,3.8),plaster)
box('Left plaster wall',(-2.8,1,1.9),(.18,7,3.8),plaster)
box('Low walnut wall panels',(-2.68,1,.58),(.06,7,1.16),walnut)
box('Panel cap',(-2.62,1,1.18),(.10,7,.045),oak)
for y in [-2,-1,0,1,2,3]: box('Vertical panel joint',(-2.635,y,.6),(.03,.023,1.12),black,bevel=0)
box('Ceiling',(0,1,3.85),(7,9,.12),plaster)
# A window opening lies in the back-right wall. No glass plane obscures outdoors.
box('Wall under window',(1.72,2.75,.4),(2.7,.18,.8),plaster)
box('Wall over window',(1.72,2.75,3.5),(2.7,.18,.7),plaster)
box('Plaster return left of window',(.19,2.75,1.95),(.46,.18,2.3),plaster)
box('Window left jamb',(.42,2.75,1.95),(.18,.20,2.3),oak,'casing')
box('Window right jamb',(3.00,2.75,1.95),(.20,.20,2.3),oak,'casing')
box('Window sill',(1.73,2.61,.85),(2.85,.42,.13),oak,'casing')
box('Window top rail',(1.73,2.63,3.09),(2.8,.20,.11),oak,'casing')
box('Window center mullion',(1.76,2.64,1.97),(.065,.14,2.20),black,'casing',.008)
box('Window transom',(1.73,2.64,2.65),(2.70,.14,.05),black,'casing',.006)
# Across the street: repeated windows, stone lintels, shop canopy and wet curb.
box('Exterior street',(1.8,6,.005),(7,7,.05),street)
box('Across street facade',(1.8,9.5,3),(9,.3,6),outside_wall)
for x in [-2.1,-.8,.5,1.8,3.1,4.4,5.7]:
    for z in [1.45,3.05,4.65]:
        box('Deep facade window recess',(x,9.28,z),(.82,.08,1.12),outside_trim,.0 if False else 'base')
        box('Sky reflecting pane',(x,9.22,z),(.66,.04,.96),outside_glass)
        box('Stone lintel',(x,9.15,z+.62),(1.02,.24,.10),stone)
        box('Stone window sill',(x,9.08,z-.62),(1.04,.30,.12),stone)
        box('Exterior window cross',(x,9.17,z),(.035,.06,1),outside_trim,bevel=.002)
box('Across storefront warm interior',(1.8,9.2,.65),(2.7,.07,1.15),lightbox)
awning=box('Fabric shop canopy',(1.8,8.85,1.55),(3.2,1.1,.10),linen); awning.rotation_euler[0]=-.12
for x in [.45,1.1,1.75,2.4,3.05]: box('Shopfront joinery',(x,9.08,.66),(.045,.12,1.3),outside_trim)
# Bar in the depth, left and middle. Explicit recognizable cafe details.
box('Counter base',(-1.48,2.7,.60),(2.25,1,1.2),walnut)
for x in [-2.45,-2.25,-2.05,-1.85,-1.65,-1.45,-1.25,-1.05,-.85,-.65,-.45]: box('Vertical counter oak fluting',(x,2.17,.60),(.055,.055,1.08),oak)
box('Stone counter top',(-1.48,2.7,1.24),(2.4,1.14,.12),stone)
box('Espresso machine body',(-1.45,2.76,1.53),(.70,.52,.52),black)
box('Espresso machine polished fascia',(-1.45,2.47,1.53),(.65,.04,.31),brass)
for x in [-1.64,-1.28]:
    cylinder('Cup on machine',(x,2.70,1.86),.055,.095,ceramic)
    curve('Espresso portafilter',[(x,2.43,1.45),(x,2.28,1.43)],.015,walnut)
for z in [1.95,2.58]:
    box('Floating walnut display shelf',(-1.61,4.02,z),(2.00,.30,.075),walnut)
    for i in range(6):
        x=-2.35+i*.27
        cylinder('Shelf ceramic canister',(x,3.95,z+.12),.068,.18,ceramic)
        cylinder('Canister oak lid',(x,3.95,z+.221),.072,.025,oak)
box('Framed abstract cafe art',(-2.65,.95,2.20),(.10,.74,.98),black)
box('Cafe art warm mat',(-2.58,.95,2.20),(.02,.64,.87),paper)
# Opposite banquette fills the centre with a calm fabric surface.
box('Banquette upholstered seat',(-.15,.70,.47),(1.7,.65,.20),linen,bevel=.10)
box('Banquette upholstered back',(-.15,1.01,.93),(1.7,.16,.85),linen,bevel=.09)
for x in [-.74,.44]: box('Banquette turned legs',(x,.64,.22),(.065,.065,.44),walnut)
for x in [-.55,.17]:
    curve('Fine fabric vertical seam',[(x,.91,.60),(x,.91,1.25)],.003,leafdark)
box('Opposite small cushion',(.42,.72,.73),(.38,.18,.39),linen,bevel=.09)
# A pendant provides a visible source for warm nighttime illumination.
cylinder('Pendant brass ceiling rose',(-1.20,1.35,3.77),.10,.08,brass)
curve('Pendant flex',[(-1.20,1.35,3.75),(-1.20,1.35,2.73)],.009,black)
bpy.ops.mesh.primitive_cone_add(vertices=64,radius1=.35,radius2=.13,depth=.30,location=(-1.20,1.35,2.59))
record(bpy.context.object,'Linen pendant shade',amber)
cylinder('Pendant underside diffuser',(-1.20,1.35,2.438),.29,.012,ceramic)

# Independent table+cup collection: whole contact relationship travels together.
table=cylinder('Foreground round oak tabletop',(-.13,-1.72,.76),1.24,.075,oak,'table',128)
cylinder('Table dark pedestal',(-.13,-1.72,.37),.085,.73,black,'table')
cylinder('Table brass pedestal foot',(-.13,-1.72,.04),.43,.035,black,'table')
cup=(-.67,-1.70,.92)
cylinder('Porcelain saucer',(cup[0],cup[1],.823),.19,.025,ceramic,'table',96)
# Revolved cup wall, genuine open mouth with liquid below the lip.
verts=[]; faces=[]
profile=[(.085,.835),(.112,.84),(.12,.88),(.125,.98),(.121,1.007),(.110,1.007),(.110,.985),(.106,.87),(.082,.855)]
N=96
for r,z in profile:
    for i in range(N):
        a=i*math.tau/N; verts.append((cup[0]+r*math.cos(a),cup[1]+r*math.sin(a),z))
for j in range(len(profile)-1):
    for i in range(N): faces.append((j*N+i,j*N+(i+1)%N,(j+1)*N+(i+1)%N,(j+1)*N+i))
mesh=bpy.data.meshes.new('Porcelain spun open shell'); mesh.from_pydata(verts,[],faces); mesh.update()
o=bpy.data.objects.new('Single coffee cup open vessel',mesh); SCENE.collection.objects.link(o); record(o,o.name,ceramic,'table')
for p in mesh.polygons:p.use_smooth=True
cylinder('Actual coffee surface',(cup[0],cup[1],.989),.108,.007,coffee,'table',96)
# Foam swirl is physical geometry, anchored in the same cup plane.
foam=mat('Milk crema',(.57,.34,.15),.4)
curve('Delicate coffee crema',[(cup[0]+.05*math.cos(t),cup[1]+.05*math.sin(t),.994) for t in [i*.14 for i in range(43)]],.002,foam,'table')
curve('Cup porcelain handle',[(cup[0]-.10,cup[1],.975),(cup[0]-.18,cup[1],.975),(cup[0]-.18,cup[1],.895),(cup[0]-.11,cup[1],.885)],.016,ceramic,'table')
book=box('Closed clothbound notebook',(.31,-1.72,.83),(.34,.48,.038),linen,'table',.009); book.rotation_euler[2]=-.20
pages=box('Notebook paper edge',(.31,-1.72,.833),(.325,.464,.022),paper,'table',.005); pages.rotation_euler[2]=-.20
curve('Brass teaspoon',[(cup[0]+.18,cup[1]-.05,.848),(cup[0]+.26,cup[1]-.14,.85)],.009,brass,'table')

# Independent foreground rubber plant; true 3D curved leaves, not billboards.
cylinder('Plant handmade clay pot',(-1.42,-1.03,.42),.23,.58,terracotta,'plant')
cylinder('Pot rich dark soil',(-1.42,-1.03,.714),.21,.018,walnut,'plant')
for k in range(5):
    a=k*2.3; bx=-1.42; by=-1.03; topz=1.60+k*.11
    tx=bx+math.cos(a)*.27; ty=by+math.sin(a)*.26
    curve('Plant branching stem',[(bx,by,.70),(bx+.03,by,1.1),(tx,ty,topz)],.009,leafdark,'plant')
    for j in range(3):
        t=.48+j*.23; p=Vector((bx,by,.70)).lerp(Vector((tx,ty,topz)),t)
        angle=a+j*2.4; length=.42; direction=Vector((math.cos(angle),math.sin(angle),.18))
        vs=[]; fs=[]
        for s in range(13):
            f=s/12; center=p+direction*length*f; center.z+=math.sin(f*math.pi)*.07
            w=math.sin(f*math.pi)*.105; side=Vector((-math.sin(angle),math.cos(angle),.15))
            vs.extend([tuple(center-side*w),tuple(center),tuple(center+side*w)])
        for s in range(12):
            for r in range(2):i=s*3+r;fs.append((i,i+1,i+4,i+3))
        me=bpy.data.meshes.new('Curved natural leaf');me.from_pydata(vs,[],fs);me.update()
        ob=bpy.data.objects.new('Glossy living rubber leaf',me);SCENE.collection.objects.link(ob);record(ob,ob.name,leafdark,'plant')
        for poly in me.polygons:poly.use_smooth=True
        solid=ob.modifiers.new('Leaf thickness','SOLIDIFY');solid.thickness=.001
        curve('Natural leaf vein',[tuple(p),tuple(p+direction*length*.92)],.002,leaflight,'plant')

sun=area('Afternoon broad window key',(4.5,5.6,5),(0,-.8,.7),1200,(1,.78,.51),4.5)
fill=area('Room bounced softbox',(-1.6,-3,2.8),(.2,1.5,1.0),220,(1,.77,.53),3)
pendant=area('Actual pendant downward light',(-1.20,1.35,2.42),(-1.20,1.35,.5),65,(1,.54,.25),.5)
backfill=area('Ambient window fill',(1.7,3.3,2.2),(-1,0,1),200,(.62,.75,1),2)

bpy.ops.object.camera_add(location=(-.48,-5.1,1.85))
CAM=bpy.context.object;CAM.name='CAFE_FIXED_PORTRAIT_32MM'
CAM.rotation_euler=(Vector((.30,1.85,1.45))-CAM.location).to_track_quat('-Z','Y').to_euler()
CAM.data.lens=33;CAM.data.sensor_fit='VERTICAL';CAM.data.sensor_height=36
CAM.data.clip_start=.1; CAM.data.clip_end=100
SCENE.camera=CAM
for o in GROUPS['plant']: o.location.x += .38
for o in GROUPS['table']: o.location.y -= .34
cup=(cup[0],cup[1]-.34,cup[2])
bpy.context.view_layer.update()

def project(point):
    p=world_to_camera_view(SCENE,CAM,Vector(point)); return [round(p.x*1440,3),round((1-p.y)*3200,3)]

def set_variant(night):
    WORLD.inputs[0].default_value=(.10,.17,.29,1) if night else (.36,.47,.57,1)
    WORLD.inputs[1].default_value=.09 if night else .4
    sun.data.energy=65 if night else 1200;sun.data.color=(.36,.52,1) if night else (1,.78,.51)
    fill.data.energy=85 if night else 220;pendant.data.energy=120 if night else 65;backfill.data.energy=80 if night else 200
    MATS['Exterior warm window lights'].node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=2.0 if night else .1
    MATS['Distant cool windows'].node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.035,.08,.13,1) if night else (.19,.27,.29,1)
    MATS['Across street limestone'].node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.085,.10,.12,1) if night else (.40,.39,.33,1)
    SCENE.view_settings.exposure=.45 if night else .3

def visible(groups):
    for group,objects in GROUPS.items():
        for o in objects:o.hide_render=group not in groups

def render(path):
    SCENE.render.filepath=str(path);bpy.ops.render.render(write_still=True)

HERE.mkdir(parents=True,exist_ok=True)
if PREVIEW:
    set_variant(False);visible(GROUPS.keys());render(HERE/'preview-afternoon.png')
    set_variant(True);render(HERE/'preview-rain-night.png')
else:
    export={'schema':1,'designWidth':1440,'designHeight':3200,'camera':{'location':list(CAM.location),'rotation':list(CAM.rotation_euler),'lens':CAM.data.lens,'sensorFit':'VERTICAL','sensorHeight':36},'cupMouth':project((cup[0],cup[1],1.007)),'windowPolygon':[project(p) for p in [(.52,2.70,.94),(2.9,2.70,.94),(2.9,2.70,3.03),(.52,2.70,3.03)]],'layers':['base','casing','plant','table'],'provenance':'Original procedural Blender geometry and materials; no imported stock or AI-generated imagery.'}
    (HERE/'camera-export.json').write_text(json.dumps(export,indent=2),encoding='utf8')
    if '--metadata' in ARGS: sys.exit(0)
    if '--mask' in ARGS:
        mask_script=(HERE/'render-window-mask.py').read_text(encoding='utf8')
        mask_script=mask_script.replace("bpy.ops.wm.open_mainfile(filepath=str(HERE/'VirtuGene-Cafe-Original.blend'))",'')
        exec(compile(mask_script,str(HERE/'render-window-mask.py'),'exec'),globals());sys.exit(0)
    if '--source' in ARGS or SOURCE_NIGHT:
        for night in ([True] if SOURCE_NIGHT else [False,True]):
            set_variant(night);visible(GROUPS.keys())
            render(HERE/('source-cafe-rain-night-2160.png' if night else 'source-cafe-afternoon-2160.png'))
        sys.exit(0)
    for variant in ['cafe-afternoon','cafe-rain-night']:
        out=HERE/'renders'/variant;out.mkdir(parents=True,exist_ok=True)
        set_variant(variant.endswith('night'))
        for group in ['base','table','plant','casing']:
            visible([group]);render(out/(group+'.png'))
    visible(GROUPS.keys());set_variant(False)
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'VirtuGene-Cafe-Original.blend'))
