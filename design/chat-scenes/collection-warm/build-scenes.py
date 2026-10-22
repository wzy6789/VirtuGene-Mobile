"""Original fixed-camera hearth cabin and night train. No imported assets.

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
SID=ARGS[ARGS.index('--scene')+1] if '--scene' in ARGS else 'hearth-cabin'
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

if SID=='hearth-cabin':
    stone=mat('Weathered warm grey limestone',(.14,.12,.10),.87,noise=(.32,.28,.23),scale=8)
    wall=mat('Lime washed plaster',(.26,.22,.17),.9,noise=(.44,.37,.29),scale=4)
    wool=mat('Moss boucle wool',(.10,.13,.10),.96,noise=(.22,.25,.17),scale=120)
    blanket=mat('Soft woven ochre throw',(.23,.12,.036),.95,noise=(.44,.27,.10),scale=140)
    snow=mat('Snow beneath night sky',(.36,.43,.5),.95)
    darkpine=mat('Snow pine silhouettes',(.019,.05,.05),.93)
    ember=mat('Orange fire core',(.95,.23,.018),.7,0,4)
    flame=mat('Golden fire tongues',(1,.28,.018),.7,0,2.5)
    bark=mat('Charred firewood',(.025,.014,.008),.95,noise=(.085,.038,.013),scale=12)
    box('Continuous oak plank floor',(0,1,-.07),(8,16,.14),wood,b=.005)
    for x in [i*.3-4 for i in range(28)]:box('Floor plank seam',(x,1,.003),(.006,16,.003),black,b=0)
    box('Back timber wall',(0,3.7,1.9),(7,.18,3.8),wall)
    box('Left cabin wall',(-3,0,1.9),(.18,8,3.8),wood)
    box('Cabin ceiling',(0,0,3.85),(7,8,.18),wood)
    for x in [-2.8,-1.4,0,1.4,2.8]:box('Ceiling hand-hewn cross beam',(x,0,3.64),(.14,8,.24),lightwood)
    for x in [-2.8,-1.5,-.2,1.1,2.6]:box('Exposed wall timber post',(x,3.56,1.9),(.13,.18,3.8),lightwood)
    # Stone fireplace in a true recess. A separate white plane behind the logs
    # will generate a depth-occluded ember mask, not an approximate rectangle.
    box('Fireplace dark recessed opening',(-.85,3.37,.71),(1.38,.14,1.20),black,b=.025)
    for x in [-1.70,.0]:
        for j in range(5):box('Laid masonry jamb',(x,3.26,.22+j*.28),(.33,.46,.26),stone,b=.045)
    for j in range(3):box('Wide fireplace stone lintel',(-.85,3.25,1.45+j*.18),(2.03,.49,.17),stone,b=.035)
    box('Deep stone hearth slab',(-.85,3.02,.08),(2.12,.94,.14),stone,b=.03)
    box('Solid walnut mantel',(-.85,3.14,2.04),(2.24,.62,.16),wood,b=.045)
    for i in range(5):
        log=cyl('Crackling firewood log',(-1.24+i*.20,3.12,.25),.065,.62,bark,v=32);log.rotation_euler[1]=math.pi/2;log.rotation_euler[2]=-.32+i*.13
    for i in range(11):
        x=-1.33+i*.105;y=3.13+rng.uniform(-.05,.04);h=rng.uniform(.26,.70)
        # Asymmetric widening/tapering teardrop meshes, not identical candle
        # ellipsoids. Flame light is baked; runtime only adds local embers.
        vs=[];fs=[];N=20
        for j in range(9):
            t=j/8;r=.062*math.sin(math.pi*(.10+.90*t))*(1-t*.55)
            for k in range(N):
                a=k*math.tau/N;vs.append((x+r*math.cos(a)+.085*math.sin(t*2.5+i)*t,y+r*.52*math.sin(a),.20+t*h))
        for j in range(8):
            for k in range(N):fs.append((j*N+k,j*N+(k+1)%N,(j+1)*N+(k+1)%N,(j+1)*N+k))
        me=bpy.data.meshes.new('Asymmetric original flame mesh');me.from_pydata(vs,[],fs);me.update();o=bpy.data.objects.new('Baked sculpted flame tongue',me);S.collection.objects.link(o);record(o,o.name,flame if i%3 else ember)
        for p in me.polygons:p.use_smooth=True
    for i in range(9):sphere('Glowing fire coal',(-1.32+i*.12,3.02,.18),(.055,.045,.018),ember)
    for x in [-1.38,-1.1,-.82,-.54,-.26]:curve('Iron log guard',[(x,2.89,.14),(x,2.89,.52)],.009,black)
    curve('Fireplace guard top',[(-1.52,2.89,.52),(.02,2.89,.52)],.012,black)
    cyl('Mantel earthen vase',(-1.46,3.12,2.28),.10,.34,cream)
    for a in [-.4,0,.4]:curve('Dry branch in vase',[(-1.46,3.12,2.36),(-1.46+a*.2,3.12,2.78)],.006,wood)
    for i in range(3):box('Mantel clothbound book',(-.36+i*.10,3.15,2.23),(.075,.25,.28),blanket,b=.006)
    # Snow window right: casing is independently cropped but stationary.
    box('Deep blue winter window view',(1.58,3.57,2.17),(1.62,.018,1.86),mat('Winter blue sky',(.055,.10,.16),.8,0,.12),b=.02)
    for x in [.68,2.48]:box('Oak window side casing',(x,3.43,2.17),(.15,.28,2.06),lightwood,'casing',.015)
    for z in [1.17,3.17]:box('Oak window horizontal casing',(1.58,3.43,z),(1.95,.28,.15),lightwood,'casing',.015)
    box('Oak window middle mullion',(1.58,3.40,2.17),(.05,.2,1.90),wood,'casing',.008)
    box('Snow visible on lower outside sill',(1.58,3.50,1.30),(1.65,.07,.13),snow,b=.02)
    for i in range(6):
        x=.91+i*.26;z=1.55+rng.random()*.25
        bpy.ops.mesh.primitive_cone_add(vertices=12,radius1=.17,radius2=0,depth=.65,location=(x,3.52,z));record(bpy.context.object,'Distant snow pine',darkpine)
    # Low reading chair rests in front of the window, part of clean plate.
    box('Reading chair upholstered cushion',(.83,1.02,.55),(1.15,1.03,.28),wool,b=.15)
    back=box('Reading chair high wingback',(.83,1.47,1.18),(1.17,.24,1.12),wool,b=.15);back.rotation_euler[0]=-.12
    for x in [.20,1.46]:box('Reading chair rounded arm',(x,1.0,.83),(.20,1.02,.43),wool,b=.09)
    for x in [.36,1.27]:
        for y in [.68,1.40]:box('Chair tapered oak leg',(x,y,.23),(.075,.075,.46),wood,b=.016)
    pillow=box('Ochre linen pillow',(.95,1.20,.92),(.48,.20,.48),blanket,b=.10);pillow.rotation_euler[1]=.12
    # Tufted thick oval rug gives a real near/far floor cue.
    rug=cyl('Thick oval woven rug',(.0,-.04,.018),1.24,.028,mat('Woven warm rug',(.19,.15,.10),.98,noise=(.30,.25,.17),scale=140),v=128);rug.scale=(1.12,1.42,1)
    for r in [1.05,1.12,1.18]:curve('Rug woven concentric piping',[(r*1.12*math.cos(i*math.tau/80),-.04+r*1.42*math.sin(i*math.tau/80),.036) for i in range(81)],.007,blanket)
    # Independent foreground basket and folded blanket, below the fire opening.
    basket=cyl('Foreground woven firewood basket',(-1.15,-.30,.24),.31,.45,blanket,'foreground',96)
    for z in [.07,.13,.19,.25,.31,.37,.43]:curve('Basket horizontal wicker weave',[(-1.15+.315*math.cos(i*math.tau/64),-.30+.315*math.sin(i*math.tau/64),z) for i in range(65)],.008,wood,'foreground')
    for i in range(4):
        log=cyl('Basket spare split log',(-1.30+i*.1,-.29,.49),.055,.54,lightwood,'foreground',32);log.rotation_euler[1]=1.25;log.rotation_euler[2]=i*.18
    curve('Basket arch handle',[(-1.45,-.3,.40),(-1.35,-.3,.8),(-.95,-.3,.8),(-.85,-.3,.40)],.018,wood,'foreground')
    # Entire low table and cup are one independent contact group.
    cyl('Near round walnut table',(.25,-1.47,.61),.77,.07,wood,'table',128)
    for a in [0,2.1,4.2]:box('Low table splayed oak leg',(.25+.41*math.cos(a),-1.47+.41*math.sin(a),.29),(.075,.075,.58),wood,'table',.015)
    CUP=cup(-.05,-1.60,.66,cream,coffee)
    book=box('Linen notebook on coffee table',(.60,-1.35,.68),(.34,.43,.035),blanket,'table',.008);book.rotation_euler[2]=-.16
    pages=box('Notebook paper edge',(.60,-1.35,.684),(.325,.416,.018),paper,'table',.004);pages.rotation_euler[2]=-.16
    area('Firelight bounced into room',(-.85,2.76,.65),(0,-1,.8),240,(1,.31,.055),.75)
    area('Snow window cool fill',(1.6,3.17,2.2),(0,.1,1),100,(.43,.62,1),1.8)
    area('Warm ceiling room bounce',(-1,-1,3.3),(0,1,1),150,(1,.67,.34),3)
    area('Front soft room bounce',(0,-3,2),(0,2,1),95,(1,.74,.47),3)
    TARGET=(0,1.8,1.35);CAMLOC=(-.1,-5.4,2.15);LENS=31
    EFFECT=[(-1.50,3.31,.17),(-.19,3.31,.17),(-.19,3.31,1.27),(-1.50,3.31,1.27)]
    LIGHT=(-.85,3.05,.75);EFFECT_AREA='hearth'
else:
    panel=mat('Midnight teal carriage wall',(.025,.055,.068),.56,noise=(.055,.095,.11),scale=13)
    navy=mat('Midnight blue woven upholstery',(.022,.045,.077),.92,noise=(.055,.10,.15),scale=120)
    trim=mat('Pearl grey train ceiling',(.10,.13,.16),.48)
    curtain=mat('Heavy blue velvet curtain',(.024,.039,.062),.94,noise=(.06,.09,.14),scale=80)
    sky=mat('Indigo night outside',(.011,.027,.067),.93,0,.15)
    hills=mat('Moonlit distant hills',(.022,.047,.068),.95)
    glasslight=mat('Tiny warm station lamps',(1,.60,.20),.4,0,4)
    lamp=mat('Train reading lamp diffuser',(.98,.72,.36),.6,0,2)
    box('Carriage oak floor',(0,1,-.06),(5.7,14,.12),wood,b=.004)
    for x in [i*.26-2.8 for i in range(22)]:box('Longitudinal floor seam',(x,1,.005),(.005,14,.004),black,b=0)
    box('Left compartment wall',(-2.6,1.3,1.9),(.14,10,3.8),panel)
    box('Right compartment wall',(2.6,1.3,1.9),(.14,10,3.8),panel)
    box('Train ceiling',(.0,1.3,3.62),(5.5,10,.14),trim,b=.09)
    box('Compartment rear bulkhead',(0,3.6,1.8),(5.5,.18,3.6),panel)
    # Oversized curved-corner panoramic train window with a genuine opening.
    box('Panoramic indigo outdoor sky',(.42,3.47,2.02),(3.55,.03,1.98),sky,b=.18)
    for x in [-1.43,2.27]:box('Rounded window side casing',(x,3.37,2.02),(.18,.24,2.19),trim,'casing',.085)
    for z in [.95,3.10]:box('Rounded window horizontal casing',(.42,3.37,z),(3.85,.24,.18),trim,'casing',.085)
    for z in [1.07,2.98]:box('Brass inner window seal',(.42,3.31,z),(3.54,.06,.025),brass,'casing',.01)
    for x in [-1.31,2.15]:box('Dark rubber window seal',(x,3.32,2.02),(.035,.08,1.91),black,'casing',.015)
    box('Window shelf and brass lip',(.40,3.11,.88),(3.87,.56,.085),wood,'casing',.025)
    box('Shelf protective brass rail',(.40,2.81,.94),(3.8,.025,.03),brass,'casing',.009)
    # Actual distant ridge geometry and sparse station lights behind the pane.
    verts=[(-1.33,3.43,1.09),(2.15,3.43,1.09)]
    ridge=[(-1.33+i*.174,3.43,1.27+.15*math.sin(i*.59)+.06*math.sin(i*1.4)) for i in range(21)]
    verts+=list(reversed(ridge));me=bpy.data.meshes.new('Night hills silhouette');me.from_pydata(verts,[],[tuple(range(len(verts)))]);me.update();o=bpy.data.objects.new('Moonlit rolling hills outside the window',me);S.collection.objects.link(o);record(o,o.name,hills)
    for i in range(8):sphere('Distant station light',(-1.1+i*.43,3.40,1.17+rng.uniform(0,.05)),(.009,.007,.009),glasslight)
    # Satin wall details, not cafe furniture.
    for x in [-2.3,-1.8,-1.55,2.45]:box('Brass vertical carriage panel edging',(x,3.44,1.8),(.018,.06,3.5),brass,b=.006)
    for z in [.46,.57,3.29]:box('Horizontal carriage panel inlay',(0,3.45,z),(5,.05,.017),brass,b=.005)
    box('Overhead luggage shelf',(-1.9,1.8,2.78),(1.05,3.5,.075),wood,b=.02)
    for y in [.3,1.4,2.5]:curve('Brass luggage rack stay',[(-2.48,y,2.86),(-1.38,y,2.86),(-1.38,y,3.22)],.018,brass)
    box('Folded travel blanket on luggage rack',(-1.94,2.25,2.89),(.70,.65,.17),navy,b=.05)
    # One sleeping/reading bench, with strong perspective and stitched piping.
    box('Quiet sleeper compartment bench seat',(-.65,.70,.54),(1.75,.98,.26),navy,b=.13)
    box('Sleeper compartment upholstered back',(-.65,1.13,1.10),(1.75,.21,.94),navy,b=.11)
    for x in [-1.59,.29]:box('Bench upholstered rounded arm',(x,.66,.77),(.16,1.0,.36),navy,b=.075)
    for x in [-1.22,-.65,-.08]:curve('Fine bench stitching',[(x,1.0,.69),(x,1.0,1.5)],.003,trim)
    for x in [-1.31,.0]:box('Seat floor mounting leg',(x,.61,.23),(.10,.14,.46),black,b=.02)
    pillow=box('Resting pillow at window',(-.10,.79,.92),(.43,.22,.43),mat('Soft grey-blue pillow',(.20,.26,.30),.94,noise=(.29,.35,.39),scale=100),b=.09);pillow.rotation_euler[1]=.18
    # Warm bronze task lamp is a visible, physically grounded light source.
    cyl('Wall reading light base',(1.66,3.22,2.63),.10,.035,brass).rotation_euler[0]=math.pi/2
    curve('Adjustable brass reading lamp arm',[(1.66,3.22,2.63),(1.66,2.96,2.62),(1.64,2.88,2.38)],.016,brass)
    shade=cyl('Small brass reading lamp hood',(1.64,2.88,2.34),.16,.15,brass);shade.rotation_euler[0]=.15
    cyl('Reading lamp amber diffuser',(1.64,2.88,2.258),.13,.009,lamp)
    # Independently cropped left velvet curtain, its whole local contact group.
    for i in range(11):
        x=-1.67+i*.055
        pts=[(x+math.sin(j*.55+i*.4)*.019,2.97+math.sin(i*.85)*.055,3.14-j*.09) for j in range(25)]
        curve('Foreground curtain hanging fold',pts,.045,curtain,'foreground')
    curve('Curtain brass tieback',[(-1.72,2.91,1.43),(-1.36,2.87,1.40),(-1.10,2.94,1.43)],.018,brass,'foreground')
    # Small near table, placed below the animated window area.
    box('Near compartment foldout table',(.76,-.90,.73),(1.12,.96,.075),wood,'table',.055)
    curve('Foldout table bracket',[(1.13,-.72,.68),(1.13,-.72,.32),(.55,-.72,.65)],.025,brass,'table')
    CUP=cup(.44,-1.05,.78,cream,coffee)
    book=box('Travel journal on shelf',(.98,-.83,.79),(.30,.39,.035),navy,'table',.008);book.rotation_euler[2]=-.12
    pages=box('Travel journal paper edges',(.98,-.83,.793),(.286,.376,.017),paper,'table',.004);pages.rotation_euler[2]=-.12
    area('Blue reflected window night light',(.55,3.08,2.22),(0,-.8,1),85,(.24,.44,1),2.8)
    area('Actual warm reading light',(1.64,2.88,2.24),(.35,.5,.6),75,(1,.62,.27),.28)
    area('Warm indirect ceiling strip',(-1.2,.5,3.35),(-.2,.5,.5),105,(1,.74,.43),2.8)
    area('Soft compartment reflected fill',(0,-3,2.5),(0,1,1),85,(.48,.62,.82),3)
    TARGET=(.1,1.9,1.45);CAMLOC=(.08,-5.2,2.05);LENS=32
    EFFECT=[(-1.27,3.40,1.10),(2.10,3.40,1.10),(2.10,3.40,2.94),(-1.27,3.40,2.94)]
    LIGHT=(1.64,2.88,2.30);EFFECT_AREA='window'

bpy.ops.object.camera_add(location=CAMLOC);CAM=bpy.context.object;CAM.name=SID.upper()+'_FIXED_PORTRAIT'
CAM.rotation_euler=(Vector(TARGET)-CAM.location).to_track_quat('-Z','Y').to_euler();CAM.data.lens=LENS;CAM.data.sensor_fit='VERTICAL';CAM.data.sensor_height=36;CAM.data.clip_start=.1;CAM.data.clip_end=100;S.camera=CAM
bpy.context.view_layer.update()
def project(p):
    v=world_to_camera_view(S,CAM,Vector(p));return [round(v.x*1440,3),round((1-v.y)*3200,3)]
def visible(groups):
    for g,objects in GROUPS.items():
        for o in objects:o.hide_render=g not in groups
def render(path,transparent=False):
    S.render.film_transparent=transparent;S.render.filepath=str(path);bpy.ops.render.render(write_still=True)
def flat(name,color):
    m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;n.clear();e=n.new('ShaderNodeEmission');e.inputs['Color'].default_value=(*color,1);e.inputs['Strength'].default_value=1;o=n.new('ShaderNodeOutputMaterial');m.node_tree.links.new(e.outputs[0],o.inputs['Surface']);return m

metadata={'schema':1,'sceneId':SID,'designWidth':1440,'designHeight':3200,'camera':{'location':list(CAM.location),'rotation':list(CAM.rotation_euler),'lens':LENS,'sensorFit':'VERTICAL','sensorHeight':36},'cupMouth':project(CUP),'windowPolygon':[project(p) for p in EFFECT],'effectArea':EFFECT_AREA,'lightCenter':project(LIGHT),'layers':['base','casing','foreground','table'],'provenance':'Original procedural Blender geometry and shaders, offline Cycles render, no imported stock or generated imagery.'}
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
        elif o.type in ['MESH','CURVE']:o.hide_render=False;o.data.materials.clear();o.data.materials.append(blackmask)
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
elif SOURCE:
    visible(GROUPS);render(OUT/f'source-{SID}-2160.png')
else:
    visible(GROUPS);bpy.ops.wm.save_as_mainfile(filepath=str(OUT/f'VirtuGene-{SID}-Original.blend'))
    if '--metadata' not in ARGS:
        rend=OUT/'renders';rend.mkdir(exist_ok=True)
        for group in GROUPS:
            visible([group]);render(rend/(group+'.png'),transparent=group!='base')
