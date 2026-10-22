"""Original cold/quiet VirtuGene spaces. Blender 4.5.3, offline, no stock.

Examples (one renderer at a time):
  blender -b -t 6 --python design/chat-scenes/collection-cool/build-scenes.py -- --preview
  blender -b -t 6 --python design/chat-scenes/collection-cool/build-scenes.py -- --export
Each scene is independently modelled. Runtime posters are composed offline
from the opaque clean plate and visibility-corrected cropped foregrounds.
"""
import bpy, math, random, json, sys
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
ARGS=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
PREVIEW='--preview' in ARGS
SCENES=['snow-study','mist-coast']
if '--scene' in ARGS:SCENES=[ARGS[ARGS.index('--scene')+1]]
W,H=(450,1000) if PREVIEW else (1440,3200)
RAND=random.Random(20261019)

def start(scene_id):
    global S,G,M,WORLD,OPENING,CUP,LIGHT_LOC,CAM
    bpy.ops.wm.read_factory_settings(use_empty=True)
    S=bpy.context.scene;S.render.engine='CYCLES';S.cycles.samples=24 if PREVIEW else 56
    S.cycles.use_denoising=True;S.cycles.use_adaptive_sampling=True
    S.cycles.denoiser='OPTIX';S.cycles.denoising_use_gpu=True
    S.cycles.adaptive_threshold=.035 if PREVIEW else .018
    S.render.threads_mode='FIXED';S.render.threads=6
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type='OPTIX';prefs.get_devices()
        for device in prefs.devices:device.use=device.type=='OPTIX'
        if any(d.use for d in prefs.devices):S.cycles.device='GPU'
    except Exception as error:print('GPU unavailable; bounded CPU6:',error)
    S.cycles.max_bounces=8;S.cycles.diffuse_bounces=3;S.cycles.glossy_bounces=4
    S.render.resolution_x=W;S.render.resolution_y=H;S.render.resolution_percentage=100
    S.render.image_settings.file_format='PNG';S.render.image_settings.color_mode='RGBA'
    S.render.film_transparent=True;S.render.dither_intensity=.1
    S.view_settings.view_transform='AgX';S.view_settings.look='AgX - Medium High Contrast'
    S.world=bpy.data.worlds.new(scene_id+' original ambient');S.world.use_nodes=True
    WORLD=S.world.node_tree.nodes.get('Background');WORLD.inputs[0].default_value=(.19,.27,.39,1)
    WORLD.inputs[1].default_value=.22
    G={n:[] for n in ['base','casing','foreground','table']};M={};OPENING=None;CUP=None;LIGHT_LOC=None
    S['virtugene_original']=True;S['external_assets']=0;S['scene_id']=scene_id

def material(name,color,rough=.6,metal=0,emit=0):
    m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*color,1)
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    if emit:p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emit
    M[name]=m;return m

def texture(name,a,b,scale=9,rough=.6,grain=(1,1,1),bump=.018):
    m=material(name,a,rough);n=m.node_tree.nodes;l=m.node_tree.links
    co=n.new('ShaderNodeTexCoord');mapping=n.new('ShaderNodeMapping');mapping.inputs['Scale'].default_value=grain
    t=n.new('ShaderNodeTexNoise');t.inputs['Scale'].default_value=scale;t.inputs['Detail'].default_value=3
    l.new(co.outputs['Generated'],mapping.inputs['Vector']);l.new(mapping.outputs['Vector'],t.inputs['Vector'])
    ramp=n.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(*a,1);ramp.color_ramp.elements[1].color=(*b,1)
    l.new(t.outputs['Fac'],ramp.inputs['Fac']);l.new(ramp.outputs['Color'],n.get('Principled BSDF').inputs['Base Color'])
    bs=n.new('ShaderNodeBump');bs.inputs['Strength'].default_value=.16;bs.inputs['Distance'].default_value=bump
    l.new(t.outputs['Fac'],bs.inputs['Height']);l.new(bs.outputs['Normal'],n.get('Principled BSDF').inputs['Normal'])
    return m

def record(o,name,mat,group):
    o.name=name;o.data.materials.append(mat);G[group].append(o);return o

def box(name,loc,size,mat,group='base',bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);record(o,name,mat,group)
    if bevel:
        b=o.modifiers.new('Crafted edge bevel','BEVEL');b.width=bevel;b.segments=3
        o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return o

def cylinder(name,loc,radius,depth,mat,group='base',vertices=64):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=loc)
    o=record(bpy.context.object,name,mat,group);b=o.modifiers.new('Turned edge','BEVEL');b.width=.008;b.segments=3
    o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');return o

def sphere(name,loc,size,mat,group='base'):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=16,location=loc)
    o=record(bpy.context.object,name,mat,group);o.scale=size
    for p in o.data.polygons:p.use_smooth=True
    return o

def curve(name,points,radius,mat,group='base'):
    c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.bevel_depth=radius;c.bevel_resolution=3
    sp=c.splines.new('BEZIER');sp.bezier_points.add(len(points)-1)
    for p,co in zip(sp.bezier_points,points):p.co=co;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,c);S.collection.objects.link(o);return record(o,name,mat,group)

def area(name,loc,target,power,color,size):
    bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name
    o.data.energy=power;o.data.color=color;o.data.shape='DISK';o.data.size=size
    o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();return o

def camera(loc,target,lens):
    global CAM
    bpy.ops.object.camera_add(location=loc);CAM=bpy.context.object;CAM.name=S['scene_id'].upper()+'_FIXED_PORTRAIT'
    CAM.rotation_euler=(Vector(target)-CAM.location).to_track_quat('-Z','Y').to_euler()
    CAM.data.lens=lens;CAM.data.sensor_fit='VERTICAL';CAM.data.sensor_height=36
    CAM.data.clip_start=.1;CAM.data.clip_end=180;S.camera=CAM

def project(point):
    p=world_to_camera_view(S,CAM,Vector(point));return [round(p.x*1440,3),round((1-p.y)*3200,3)]

def book(name,loc,dimensions,cover,group='base',rotation=0):
    paper=M['Paper'];o=box(name+' cover',loc,dimensions,cover,group,.009);o.rotation_euler[2]=rotation
    inner=box(name+' leaves',(loc[0],loc[1],loc[2]+.001),(dimensions[0]-.025,dimensions[1]-.012,dimensions[2]-.015),paper,group,.003)
    inner.rotation_euler[2]=rotation
    return o

def cup(loc,mat,group='table'):
    global CUP
    x,y,z=loc;cylinder('Quiet tea saucer',(x,y,z),.19,.025,mat,group)
    profile=[(.085,z+.016),(.117,z+.032),(.124,z+.14),(.119,z+.18),(.108,z+.18),(.108,z+.155),(.099,z+.047)]
    vs=[];fs=[];N=96
    for r,h in profile:
        for i in range(N):a=i*math.tau/N;vs.append((x+r*math.cos(a),y+r*math.sin(a),h))
    for k in range(len(profile)-1):
        for i in range(N):fs.append((k*N+i,k*N+(i+1)%N,(k+1)*N+(i+1)%N,(k+1)*N+i))
    mesh=bpy.data.meshes.new('Actual open ceramic cup');mesh.from_pydata(vs,[],fs);mesh.update()
    o=bpy.data.objects.new('Single open steaming tea cup',mesh);S.collection.objects.link(o);record(o,o.name,mat,group)
    for p in mesh.polygons:p.use_smooth=True
    cylinder('Tea liquid visible inside cup',(x,y,z+.16),.105,.005,M['Tea'],group)
    curve('Ceramic handle',[(x-.11,y,z+.15),(x-.19,y,z+.15),(x-.19,y,z+.07),(x-.11,y,z+.05)],.014,mat,group)
    CUP=(x,y,z+.18)

def snow_scene():
    global OPENING,LIGHT_LOC
    ink=texture('Ink blue mineral wall',(.039,.062,.096),(.10,.14,.20),4,.91,bump=.01)
    oak=texture('Dark silvered oak',(.055,.043,.033),(.19,.15,.105),7,.43,(1,32,2))
    brass=material('Aged desk-lamp brass',(.32,.21,.10),.31,.65)
    trim=material('Blue black window joinery',(.018,.034,.055),.31,.42)
    linen=texture('Glacier blue woven upholstery',(.12,.18,.23),(.30,.37,.40),100,.95,bump=.005)
    wool=texture('Ivory wool blanket',(.46,.48,.45),(.68,.68,.61),110,1,bump=.005)
    paper=material('Paper',(.58,.55,.46),.95)
    tea=material('Tea',(.10,.052,.022),.22)
    porcelain=material('Snow grey porcelain',(.60,.66,.66),.25)
    snow=texture('Fresh snow fine sparkle',(.60,.70,.82),(.86,.91,.96),26,.72,bump=.012)
    bark=texture('Cold birch bark',(.28,.32,.35),(.62,.67,.70),19,.93,(4,4,1))
    pine=material('Blue spruce foliage',(.018,.044,.057),.94)
    covers=[material('Cloth book '+str(i),color,.85) for i,color in enumerate([(.15,.20,.23),(.26,.17,.13),(.30,.32,.27),(.11,.15,.22),(.35,.27,.18),(.19,.12,.16)])]
    sky=material('Deep snow dusk sky',(.085,.14,.24),.9,0,.5)
    lamp=material('Warm parchment desk shade',(.72,.49,.23),.6,0,.8)
    # Books, window, chair, desk are placed at different depths, never billboards.
    box('Continuous smoked oak floor',(0,1,-.07),(10,15,.14),oak,bevel=.006)
    for x in [i*.34-5 for i in range(31)]:box('Long oak plank seam',(x,1,.004),(.007,15,.004),trim,bevel=0)
    box('Left ink plaster wall',(-2.9,1.8,2.1),(.18,10,4.2),ink)
    box('Rear wall above glass',(0,3.6,3.8),(6,.18,1),ink)
    box('Rear wall below glass',(0,3.6,.43),(6,.18,.86),ink)
    box('Rear left bookcase return',(-2.35,3.6,2.05),(1.3,.18,3.7),ink)
    box('Rear right bookcase return',(2.9,3.6,2.05),(.5,.18,3.7),ink)
    box('Ceiling',(0,1.8,4.25),(6.2,10,.15),ink)
    # Long horizontal snow view, with physically deep jambs.
    OPENING={'location':(.55,3.57,2.10),'size':(4.14,.008,2.40)}
    for x in [-1.58,2.68]:box('Window side silver oak frame',(x,3.45,2.10),(.16,.26,2.66),oak,'casing',.012)
    for z in [.86,3.35]:box('Window horizontal silver oak frame',(.55,3.45,z),(4.4,.28,.15),oak,'casing',.012)
    box('Window single dark mullion',(.58,3.39,2.10),(.055,.14,2.40),trim,'casing',.004)
    box('Deep reading window sill',(.55,3.29,.84),(4.55,.55,.12),oak,'casing',.018)
    # Snow garden beyond the wall: horizon fog, ground, individual firs and birch.
    box('Snow-night sky backdrop',(0,36,10),(70,.3,35),sky,bevel=0)
    box('Snowfield',(0,18,-.02),(70,46,.1),snow,bevel=0)
    # Winter birches have irregular split branches rather than repeated cone
    # silhouettes. Snow rests on the upward sides of the actual branches.
    for i in range(17):
        x=-12+i*1.55+RAND.uniform(-.30,.30);y=7.8+(i%4)*3.1;h=RAND.uniform(4.3,6.3)
        lean=RAND.uniform(-.20,.20)
        curve('Slender winter birch trunk',[(x,y,0),(x+.06,y,h*.55),(x+lean,y+.08,h)],.045,bark)
        for k in range(8):
            z=h*(.28+k*.073);sgn=(-1)**k;span=RAND.uniform(.60,1.15)*(1-k*.045)
            a=(x+lean*z/h,y,z);b=(x+sgn*span*.60,y+.04,z+.23);c=(x+sgn*span,y+.10,z+.39)
            curve('Bare branching birch arm',[a,b,c],.016 if k>3 else .023,bark)
            curve('Snow lining birch branch',[(a[0],a[1],a[2]+.025),(b[0],b[1],b[2]+.023),(c[0],c[1],c[2]+.015)],.013,snow)
            for j in range(2):
                f=.42+j*.28;fork=(a[0]+(c[0]-a[0])*f,y+.06,z+.18+j*.12)
                curve('Fine natural winter fork',[fork,(fork[0]+sgn*.12,y+.08,fork[2]+.19),(fork[0]+sgn*.20,y+.08,fork[2]+.32)],.007,bark)
    # Built-in book wall on the left. Thin brass shelf edges catch the lamp.
    box('Tall left bookshelf dark back',(-2.56,1.16,1.82),(.30,3.42,3.5),oak)
    for z in [.25,.85,1.45,2.05,2.65,3.25]:
        box('Reading-room shelf',(-2.36,1.13,z),(.68,3.38,.07),oak)
        for j in range(15):
            y=-.39+j*.209;bh=RAND.uniform(.29,.50);bw=RAND.uniform(.10,.17)
            b=box('Spine '+str(j),(-2.31,y,z+.04+bh*.5),(.37,bw,bh),covers[(j+int(z*10))%len(covers)],bevel=.007)
            box('Book spine narrow foil',(-2.115,y,z+bh*.72),(.003,bw*.70,.007),brass,bevel=0)
    # Chair under snowy window: padded volumes and curved wooden arms.
    box('Reading chair lower cushion',(.87,.65,.53),(1.12,.95,.25),linen,bevel=.12)
    back=box('Reading chair tall back',(.87,1.03,1.03),(1.12,.23,1.05),linen,bevel=.13);back.rotation_euler[0]=-.12
    for x in [.26,1.48]:
        curve('Bent oak chair arm',[(x,.18,.52),(x,.21,.89),(x,.8,.99),(x,1.03,.80)],.045,oak)
        for y in [.31,.91]:box('Chair oak leg',(x,y,.27),(.06,.06,.54),oak)
    cushion=box('Small linen back cushion',(.96,.76,.90),(.47,.16,.49),wool,bevel=.10);cushion.rotation_euler[2]=.11
    # Independent foreground blanket on a nearby stool; far below window mask.
    cylinder('Oak reading footstool',(-1.16,-.78,.36),.42,.16,oak,'foreground')
    blanket=box('Folded ivory knitted blanket',(-1.16,-.79,.49),(.64,.61,.17),wool,'foreground',.06);blanket.rotation_euler[2]=-.18
    for i in range(12):curve('Blanket woven edge', [(-1.48+i*.051,-1.10,.55),(-1.48+i*.051,-1.12,.43)],.006,wool,'foreground')
    # Foreground desk, single cup and contact shadows all travel together.
    box('Writing desk broad walnut top',(-.40,-2.71,.79),(3.20,1.34,.11),oak,'table',.045)
    for x in [-1.78,.98]:
        for y in [-3.17,-2.22]:box('Writing desk tapered legs',(x,y,.39),(.075,.075,.78),oak,'table')
    book('Open cloth journal',(.15,-2.73,.88),(.42,.57,.055),covers[0],'table',-.13)
    curve('Slim brass fountain pen',[(-.10,-2.54,.921),(.22,-2.48,.921)],.009,brass,'table')
    cup((-.74,-2.78,.856),porcelain)
    # Modest source light: a real articulated desk lamp, warm against blue snow.
    cylinder('Desk lamp heavy circular foot',(-1.44,-2.40,.88),.16,.032,brass,'table')
    curve('Desk lamp slender stem',[(-1.44,-2.40,.90),(-1.44,-2.40,1.32),(-1.20,-2.40,1.52)],.018,brass,'table')
    bpy.ops.mesh.primitive_cone_add(vertices=64,radius1=.27,radius2=.12,depth=.27,location=(-1.20,-2.40,1.49))
    record(bpy.context.object,'Parchment lamp conical shade',lamp,'table')
    cylinder('Lamp warm underside',(-1.20,-2.40,1.35),.24,.012,porcelain,'table')
    area('Desk lamp actual pool',(-1.20,-2.40,1.34),(-.6,-2.7,.80),58,(1,.61,.30),.28)
    LIGHT_LOC=(-1.2,-2.4,1.49)
    area('Snow silver-blue window fill',(1,4.2,4),(0,-1,.9),260,(.50,.67,1),4.6)
    area('Very soft camera-side moon bounce',(-1,-5,3),(0,1,1.3),45,(.64,.74,1),4)
    area('Warm distant shelf bounce',(-1.7,.2,2.1),(-2.5,1.2,1.8),14,(1,.58,.28),1)
    WORLD.inputs[0].default_value=(.19,.28,.43,1);WORLD.inputs[1].default_value=.12
    S.view_settings.exposure=.45
    camera((.12,-7.7,2.55),(-.08,1.25,1.50),31)

def coast_scene():
    global OPENING,LIGHT_LOC
    plaster=texture('Pearl chalk limewash',(.44,.51,.53),(.69,.74,.73),4,.92,bump=.012)
    concrete=texture('Pale mineral floor',(.29,.37,.40),(.48,.54,.54),21,.64,bump=.009)
    oak=texture('Bleached ash timber',(.27,.27,.23),(.55,.53,.44),7,.42,(1,40,2))
    silver=material('Brushed ocean silver',(.32,.41,.46),.24,.75)
    linen=texture('Undyed cool linen',(.44,.48,.47),(.72,.73,.67),105,.96,bump=.004)
    slate=texture('Soft slate wool throw',(.16,.24,.30),(.36,.43,.47),95,.97,bump=.006)
    paper=material('Paper',(.67,.68,.62),.95)
    bookcover=material('Sea grey cloth book',(.19,.27,.29),.83)
    ceramic=texture('Handmade smoke porcelain',(.30,.39,.40),(.49,.55,.52),11,.32,bump=.009)
    pebble=texture('Smooth shore pebbles',(.13,.20,.24),(.31,.38,.39),8,.48)
    sea=texture('Quiet sea long fine waves',(.12,.28,.35),(.33,.49,.53),50,.28,(1,8,1),.018)
    sea.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value=.23
    sky=material('White coastal morning mist',(.51,.64,.69),.98,0,.65)
    rock=texture('Distant basalt promontory',(.16,.26,.29),(.36,.44,.44),5,.95)
    # Spacious, minimal architecture, unrelated to the book room/cafe geometry.
    box('Continuous pale coastal floor',(0,1,-.08),(13,18,.16),concrete,bevel=.005)
    box('Left curved-wall backing',(-3.3,1.7,2.1),(.22,12,4.2),plaster)
    box('Rear parapet under panoramic glass',(0,4.0,.51),(7,.24,1.02),plaster)
    box('Rear lintel above panoramic glass',(0,4,3.90),(7,.30,.70),plaster)
    box('Left panoramic return',(-3.3,4,2.3),(.50,.42,3.2),plaster)
    box('Right panoramic return',(3.3,4,2.3),(.50,.42,3.2),plaster)
    box('High chalk ceiling',(0,1.4,4.24),(7.2,12,.14),plaster)
    # Raised shadow seam makes the wide window physically sit in the wall.
    OPENING={'location':(0,3.98,2.3),'size':(6.08,.008,2.52)}
    for x in [-3.08,3.08]:box('Panoramic side brushed frame',(x,3.84,2.30),(.065,.16,2.66),silver,'casing',.006)
    for z in [1.01,3.59]:box('Panoramic horizontal brushed frame',(0,3.84,z),(6.24,.19,.06),silver,'casing',.005)
    box('Off-centre narrow panorama mullion',(1.40,3.83,2.30),(.04,.13,2.55),silver,'casing',.003)
    box('Deep pale ash window seat',(0,3.64,.98),(6.35,.64,.13),oak,'casing',.02)
    # Infinite-looking sea is actual textured water geometry at several depths.
    box('Quiet coast water plane',(0,49,.33),(160,100,.08),sea,bevel=0)
    box('Coastal fog sky backdrop',(0,105,21),(220,.4,80),sky,bevel=0)
    # Remote low islands have real irregular meshes with distance-soft colours.
    for i,(x,y,sx,sy,h) in enumerate([(-9,25,4,2,1.0),(12,38,7,3,1.1),(-18,62,8,5,1.4)]):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3,radius=1,location=(x,y,.24))
        ob=record(bpy.context.object,'Distant weather-worn basalt island '+str(i),rock,'base')
        for v in ob.data.vertices:
            n=1+RAND.uniform(-.07,.07);v.co.x*=sx*n;v.co.y*=sy*n
            v.co.z=abs(v.co.z)*h*(1+RAND.uniform(-.10,.10)) if v.co.z>0 else -.25
        for p in ob.data.polygons:p.use_smooth=True
    # One sculptural lounge chair at the right, leaving sea and horizon open.
    chairx=1.15;chairy=.55
    seat=box('Low linen lounge seat',(chairx,chairy,.48),(1.27,1.15,.25),linen,bevel=.14);seat.rotation_euler[2]=-.13
    back=box('Tall softly curved linen back',(chairx+.07,chairy+.42,1.04),(1.23,.24,1.13),linen,bevel=.15);back.rotation_euler[0]=-.18;back.rotation_euler[2]=-.13
    for x in [chairx-.71,chairx+.71]:
        curve('Bent ash lounge arm',[(x,chairy-.34,.28),(x,chairy-.35,.85),(x,chairy+.38,.91),(x,chairy+.61,.22)],.048,oak)
        curve('Curved ash lounge runner',[(x,chairy-.46,.10),(x,chairy,.06),(x,chairy+.63,.10)],.042,oak)
    box('Lounge seat lumbar pillow',(chairx+.13,chairy+.22,.80),(.60,.20,.36),linen,bevel=.11)
    # Independent foreground lower-right pouf and thrown blanket, below glazing.
    pouf=cylinder('Low round shoreline pouf',(1.11,-1.40,.29),.58,.45,linen,'foreground',96)
    throw=box('Slate wool folded throw',(1.06,-1.46,.57),(.82,.63,.14),slate,'foreground',.075);throw.rotation_euler[2]=.16
    for j in range(15):curve('Wool throw fine fringe',[(.68+j*.051,-1.80,.59),(.68+j*.051,-1.86,.51)],.005,slate,'foreground')
    # Low terrazzo side table and original objects, no cup/false steam anchor.
    cylinder('Near sculptural low ash side table',(-.92,-2.12,.55),.83,.095,oak,'table',96)
    cylinder('Solid coastal table base',(-.92,-2.12,.27),.36,.50,concrete,'table',96)
    book('Linen bound tide notebook',(-.58,-2.13,.625),(.34,.49,.052),bookcover,'table',.17)
    cylinder('Stoneware vase foot',(-1.24,-2.13,.636),.15,.026,ceramic,'table')
    # Lathed architectural vase with slim lip.
    profile=[(.10,.65),(.19,.72),(.18,.91),(.09,1.07),(.08,1.11),(.069,1.11),(.07,1.06)]
    vs=[];fs=[];N=64
    for r,z in profile:
        for j in range(N):a=j*math.tau/N;vs.append((-1.24+r*math.cos(a),-2.13+r*math.sin(a),z))
    for k in range(len(profile)-1):
        for j in range(N):fs.append((k*N+j,k*N+(j+1)%N,(k+1)*N+(j+1)%N,(k+1)*N+j))
    me=bpy.data.meshes.new('Original handmade vessel');me.from_pydata(vs,[],fs);me.update();ob=bpy.data.objects.new('Smoke porcelain coastal vase',me);S.collection.objects.link(ob);record(ob,ob.name,ceramic,'table')
    for p in me.polygons:p.use_smooth=True
    for j in range(3):sphere('Collected shore pebble',(-1.03+j*.13,-2.40+.035*j,.633),(.085,.055,.035),pebble,'table')
    # Slim dried grasses do not pretend to be water or touch the sea window.
    for k in range(3):
        tx=-1.25+(k-1)*.14;ty=-2.13+(k-1)*.03;tz=1.56+k*.12
        curve('Dried coastal grass stem',[(-1.24,-2.13,1.03),(tx,-2.14,1.32),(tx+.10,ty,tz)],.006,oak,'table')
        for j in range(5):
            z=tz-.16+j*.04;curve('Delicate coastal seed head',[(tx+.07,ty,z),(tx+.15,ty+.025,z+.045)],.008,oak,'table')
    # Gentle diffuse dawn comes only through sea glass; warm hidden sources absent.
    area('Huge overcast sea window',(0,6.0,4.8),(0,-1,.8),1250,(.70,.86,1),6.5)
    area('Soft pearl return fill',(-2.1,-4,3.2),(1,1.5,1.0),110,(1,.94,.84),4)
    WORLD.inputs[0].default_value=(.43,.56,.65,1);WORLD.inputs[1].default_value=.32
    S.view_settings.exposure=.15
    LIGHT_LOC=(1.2,3.85,2.7)
    camera((-.25,-7.8,2.50),(.15,1.3,1.55),30)

def full_visibility():
    for objects in G.values():
        for o in objects:o.hide_render=False;o.visible_camera=True

def visible_group(group):
    # Keep non-camera geometry in the light transport so the selected objects
    # retain their actual reflected light and contact shadows.
    for name,objects in G.items():
        for o in objects:o.hide_render=False;o.visible_camera=name==group

def render(path):
    S.render.filepath=str(path);bpy.ops.render.render(write_still=True)

def emission_mat(name,color):
    m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;n.clear()
    e=n.new('ShaderNodeEmission');e.inputs['Color'].default_value=(*color,1)
    out=n.new('ShaderNodeOutputMaterial');m.node_tree.links.new(e.outputs[0],out.inputs['Surface']);return m

def masks(out):
    # A full-scene visibility pass, not a guessed screen polygon. Every physical
    # frame, chair, book, stem and table blocks the semantic window plane.
    S.render.film_transparent=False;S.render.dither_intensity=0;S.cycles.samples=8;S.cycles.use_denoising=False
    S.view_settings.view_transform='Standard';S.view_settings.look='None';S.view_settings.exposure=0;S.view_settings.gamma=1
    WORLD.inputs[1].default_value=0
    for o in S.objects:
        if o.type=='LIGHT':o.data.energy=0
    black=emission_mat('Visibility opaque blocker',(0,0,0));white=emission_mat('Visibility target',(1,1,1))
    for objects in G.values():
        for o in objects:o.hide_render=False;o.visible_camera=True;o.data.materials.clear();o.data.materials.append(black)
    for name in ['casing','foreground','table']:
        for o in G[name]:o.data.materials[0]=white
        render(out/(name+'-visibility.png'))
        for o in G[name]:o.data.materials[0]=black
    bpy.ops.mesh.primitive_cube_add(size=1,location=OPENING['location']);o=bpy.context.object
    o.name='Semantic window opening only';o.dimensions=OPENING['size'];o.data.materials.append(white)
    render(out/'window-visibility.png')

for scene_id in SCENES:
    if scene_id not in ['snow-study','mist-coast']:raise ValueError(scene_id)
    start(scene_id)
    if scene_id=='snow-study':snow_scene()
    else:coast_scene()
    bpy.context.view_layer.update();out=HERE/scene_id;out.mkdir(parents=True,exist_ok=True)
    if PREVIEW:
        full_visibility();render(out/'preview.png');continue
    full_visibility()
    metadata={'schema':1,'sceneId':scene_id,'designWidth':1440,'designHeight':3200,
      'camera':{'location':list(CAM.location),'rotation':list(CAM.rotation_euler),'lens':CAM.data.lens,'sensorFit':'VERTICAL','sensorHeight':36},
      'layers':['base','casing','foreground','table'],'windowOpening':OPENING,
      'windowPolygon':[project((OPENING['location'][0]+dx*OPENING['size'][0]/2,OPENING['location'][1],OPENING['location'][2]+dz*OPENING['size'][2]/2)) for dx,dz in [(-1,-1),(1,-1),(1,1),(-1,1)]],
      'lightRect':([project(LIGHT_LOC)[0]-210,project(LIGHT_LOC)[1]-180,420,500] if scene_id=='snow-study' else [650,800,650,1050]),
      'provenance':'Original procedural Blender geometry and node materials; no external models, textures, stock or online generation.'}
    if CUP:metadata['cupMouth']=project(CUP)
    (out/'camera-export.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf8')
    # Native high resolution source, NEVER resized from runtime exports.
    S.render.resolution_x=2160;S.render.resolution_y=4800;S.cycles.samples=72
    render(out/('source-'+scene_id+'-2160.png'))
    S.render.resolution_x=1440;S.render.resolution_y=3200;S.cycles.samples=56
    bpy.ops.wm.save_as_mainfile(filepath=str(out/('VirtuGene-'+scene_id+'-Original.blend')))
    for group in ['base','casing','foreground','table']:
        visible_group(group);render(out/(group+'.png'))
    full_visibility();masks(out)
    print('VG_SCENE_RENDER_COMPLETE '+scene_id,flush=True)
