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
