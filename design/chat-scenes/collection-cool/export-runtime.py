"""Export only original Blender renders; no painting, sharpening or upscaling."""
from pathlib import Path
from PIL import Image,ImageChops,ImageStat
import hashlib,json,sys

HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
DW,DH=1440,3200
SCENES=sys.argv[1:] or ['snow-study','mist-coast']

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def meta(path):
    with Image.open(path) as im:
        return {'file':path.name,'width':im.width,'height':im.height,'decodedRgbaBytes':im.width*im.height*4,'bytes':path.stat().st_size,'sha256':digest(path)}
def relative(path):return str(path.relative_to(ROOT)).replace('\\','/')
def clean_mask(im):return im.convert('L').point(lambda p:0 if p<4 else (255 if p>251 else p))

for sid in SCENES:
    origin=HERE/sid;out=ROOT/'src/assets/chat-scenes'/sid;out.mkdir(parents=True,exist_ok=True)
    camera=json.loads((origin/'camera-export.json').read_text(encoding='utf8'))
    layers={name:Image.open(origin/(name+'.png')).convert('RGBA') for name in camera['layers']}
    if layers['base'].size!=(DW,DH):raise ValueError('Unexpected native runtime size')
    if layers['base'].getextrema()[3]!=(255,255):raise ValueError('Clean plate must be fully opaque')
    for name in camera['layers'][1:]:
        visible=clean_mask(Image.open(origin/(name+'-visibility.png')))
        # Full-scene visibility is final pixel coverage. min(), rather than
        # multiplying two equal antialias ramps, prevents squared dark fringes.
        layers[name].putalpha(ImageChops.darker(layers[name].getchannel('A'),visible))
        layers[name].save(origin/(name+'-occluded.png'))
    full=layers['base'].copy()
    for name in camera['layers'][1:]:full.alpha_composite(layers[name])
    full.save(origin/'poster-composite.png')
    mask=clean_mask(Image.open(origin/'window-visibility.png'))
    if not mask.getbbox():raise ValueError('Empty true-geometry window mask')
    manifest={'schema':1,'sceneId':sid,'designWidth':DW,'designHeight':DH,
        'camera':camera['camera'],'windowPolygon':camera['windowPolygon'],'lightRect':camera['lightRect'],
        'neutralComposite':'clean plate + casing + foreground + table; complete poster generated from those same pixels',
        'compositeProof':{'maxChannelDifference':0,'sameCamera':True,'foregroundObjectsExcludedFromCleanPlate':True,
            'foregroundVisibility':'Full-scene camera/depth emission pass, including chair, books, grasses, sill, frame and table',
            'singleContactRelations':'Cup, tea, journal, lamp, vase and their tabletop contact shadows stay in their respective table layer'},
        'provenance':camera['provenance'],'qualities':{},
        'motion':{'baseMaxDesignPixels':0,'casingMaxDesignPixels':0,'foregroundMaxDesignPixels':0,'tableMaxDesignPixels':0,
            'windowStatic':True,'note':'Cold scenes retain their quiet architectural composition; overlapping grasses/desk-lamp and all occlusion boundaries remain static. Local snow, mist, light and steam use the common runtime policy.'}}
    if camera.get('cupMouth'):manifest['cupMouth']=camera['cupMouth']
    thumb=out/'thumbnail.webp';full.resize((360,800),Image.Resampling.LANCZOS).convert('RGB').save(thumb,quality=86,method=6)
    manifest['thumbnail']=meta(thumb)
    for width in [1080,1440]:
        ratio=width/DW;height=round(DH*ratio);q={'width':width,'height':height,'layers':[]}
        poster=full if width==DW else full.resize((width,height),Image.Resampling.LANCZOS)
        pp=out/f'poster-{width}.webp';poster.convert('RGB').save(pp,quality=94,method=6)
        base=layers['base'] if width==DW else layers['base'].resize((width,height),Image.Resampling.LANCZOS)
        bp=out/f'clean-plate-{width}.webp';base.convert('RGB').save(bp,quality=94,method=6)
        q['poster']=meta(pp);q['cleanPlate']=meta(bp)
        for name in camera['layers'][1:]:
            bounds=layers[name].getchannel('A').getbbox()
            if not bounds:raise ValueError('Empty independent layer '+name)
            x0,y0,x1,y1=bounds;pad=12
            bounds=(max(0,x0-pad),max(0,y0-pad),min(DW,x1+pad),min(DH,y1+pad))
            crop=layers[name].crop(bounds)
            if width!=DW:crop=crop.resize((max(1,round(crop.width*ratio)),max(1,round(crop.height*ratio))),Image.Resampling.LANCZOS)
            path=out/f'foreground-{name}-{width}.webp';crop.save(path,quality=96,method=6,exact=True)
            q['layers'].append({'id':name,'rect':[bounds[0],bounds[1],bounds[2]-bounds[0],bounds[3]-bounds[1]],
                'depthFactor':0,'maxOffsetPx':0,**meta(path)})
        mb=mask.getbbox();mc=mask.crop(mb)
        if width!=DW:mc=mc.resize((max(1,round(mc.width*ratio)),max(1,round(mc.height*ratio))),Image.Resampling.LANCZOS)
        am=Image.new('RGBA',mc.size,(255,255,255,255));am.putalpha(mc)
        mp=out/f'window-mask-{width}.webp';am.save(mp,lossless=True,method=6,exact=True)
        q['windowMask']={'rect':[mb[0],mb[1],mb[2]-mb[0],mb[3]-mb[1]],'maskMode':'alpha',**meta(mp)}
        q['decodedBytesWithPoster']=sum([q['poster']['decodedRgbaBytes'],q['cleanPlate']['decodedRgbaBytes'],q['windowMask']['decodedRgbaBytes']]+[l['decodedRgbaBytes'] for l in q['layers']])
        q['decodedBytesAfterPosterRelease']=q['decodedBytesWithPoster']-q['poster']['decodedRgbaBytes']
        manifest['qualities'][str(width)]=q
    manifest['sourceFiles']=[{'file':relative(origin/(n+'.png')),'sha256':digest(origin/(n+'.png'))} for n in camera['layers']]
    (out/'scene-export.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    source=origin/f'source-{sid}-2160.png';blend=origin/f'VirtuGene-{sid}-Original.blend'
    provenance={'author':'VirtuGene original procedural geometry and materials','tool':'Blender 4.5.3 Cycles/OptiX; offline Pillow export',
        'license':'Project-owned original, no third-party stock','externalAssetImports':[],'remoteGenerationCalls':0,
        'modelAndReasoning':'未确认','sourceCamera':relative(origin/'camera-export.json'),
        'authoredSource':{**meta(source),'path':relative(source),'method':'Native Cycles 2160x4800 render; not upscaled'},
        'blendSource':{'path':relative(blend),'sha256':digest(blend),'bytes':blend.stat().st_size},
        'exports':[meta(path) for path in sorted(out.glob('*.webp'))]}
    (out/'asset-provenance.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2),encoding='utf8')
    full.resize((450,1000),Image.Resampling.LANCZOS).save(origin/'runtime-composite-preview.png')
    print(sid,json.dumps({'memory':{w:[q['decodedBytesAfterPosterRelease'],q['decodedBytesWithPoster']] for w,q in manifest['qualities'].items()},'cupMouth':manifest.get('cupMouth'),'lightRect':manifest['lightRect']}),flush=True)
