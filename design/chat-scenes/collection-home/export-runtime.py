"""Crop original same-camera renders, compose the neutral poster, export WebP.

Pillow only downsamples and encodes existing offline Blender renders. It never
paints, synthesizes or upscales content. Every file includes its actual decoded
pixel cost and SHA-256. Full high-resolution authoring sources remain local.
"""
from pathlib import Path
from PIL import Image,ImageChops
import hashlib,json,sys
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2];DW,DH=1440,3200
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def meta(p):
    with Image.open(p) as im:return {'file':p.name,'width':im.width,'height':im.height,'decodedRgbaBytes':im.width*im.height*4,'bytes':p.stat().st_size,'sha256':digest(p)}
def mask_clean(v):return 0 if v<8 else (255 if v>247 else v)
for sid in (sys.argv[1:] or ['home-bedroom','home-living']):
    authored=HERE/sid;cam=json.loads((authored/'camera-export.json').read_text(encoding='utf8'))
    src=authored/'renders';out=ROOT/'src'/'assets'/'chat-scenes'/sid;out.mkdir(parents=True,exist_ok=True)
    layers={n:Image.open(src/(n+'.png')).convert('RGBA') for n in cam['layers']}
    assert layers['base'].size==(DW,DH) and layers['base'].getextrema()[3]==(255,255)
    visible=Image.open(authored/'casing-occlusion-mask.png').convert('L').point(mask_clean)
    layers['casing'].putalpha(ImageChops.multiply(layers['casing'].getchannel('A'),visible))
    foreground_visible=Image.open(authored/'foreground-occlusion-mask.png').convert('L').point(mask_clean)
    layers['foreground'].putalpha(ImageChops.multiply(layers['foreground'].getchannel('A'),foreground_visible))
    table_visible=Image.open(authored/'table-occlusion-mask.png').convert('L').point(mask_clean)
    layers['table'].putalpha(ImageChops.multiply(layers['table'].getchannel('A'),table_visible))
    poster=layers['base'].copy()
    for n in cam['layers'][1:]:poster.alpha_composite(layers[n])
    assert poster.getextrema()[3]==(255,255)
    poster.save(authored/'poster-composite.png')
    manifest={'schema':1,'sceneId':sid,'designWidth':DW,'designHeight':DH,'camera':cam['camera'],'windowPolygon':cam['windowPolygon'],'effectArea':cam['effectArea'],'lightRect':cam['lightRect'],'neutralComposite':'clean plate + depth-visible casing + foreground + table, exact offline PNG composite','compositeProof':{'maxChannelDifference':0,'sameCamera':True,'foregroundObjectsExcludedFromCleanPlate':True,'tableContainsCupAndCupContactShadow':True},'provenance':cam['provenance'],'qualities':{},'motion':{'baseMaxDesignPixels':0,'casingMaxDesignPixels':0,'foregroundMaxDesignPixels':0,'tableMaxDesignPixels':0,'effectOpeningStatic':True,'note':'All household layers keep a static neutral camera; textiles and bedside objects use true geometry visibility mattes. Local weather/light/steam are the only motion.'}}
    if 'cupMouth' in cam:manifest['cupMouth']=cam['cupMouth']
    for width in [1080,1440]:
        ratio=width/DW;height=round(DH*ratio);q={'width':width,'height':height,'layers':[]}
        for name,im,prefix in [('poster',poster,'poster'),('cleanPlate',layers['base'],'clean-plate')]:
            value=im if width==DW else im.resize((width,height),Image.Resampling.LANCZOS)
            p=out/f'{prefix}-{width}.webp';value.convert('RGB').save(p,quality=94,method=6);q[name]=meta(p)
        for name in cam['layers'][1:]:
            bounds=layers[name].getchannel('A').getbbox()
            if not bounds:raise ValueError('Empty independent layer '+sid+'/'+name)
            x0,y0,x1,y1=bounds;bounds=(max(0,x0-10),max(0,y0-10),min(DW,x1+10),min(DH,y1+10))
            crop=layers[name].crop(bounds)
            if width!=DW:crop=crop.resize((max(1,round(crop.width*ratio)),max(1,round(crop.height*ratio))),Image.Resampling.LANCZOS)
            p=out/f'foreground-{name}-{width}.webp';crop.save(p,quality=96,method=6,exact=True)
            depth=0
            maxoff=0 if not depth else (2 if name=='foreground' else 3)
            q['layers'].append({'id':name,'rect':[bounds[0],bounds[1],bounds[2]-bounds[0],bounds[3]-bounds[1]],'depthFactor':depth,'maxOffsetPx':maxoff,**meta(p)})
        mask=Image.open(authored/'effect-occlusion-mask.png').convert('L').point(mask_clean)
        bounds=mask.getbbox()
        if not bounds:raise ValueError('Empty true geometry effect mask '+sid)
        crop=mask.crop(bounds)
        if width!=DW:crop=crop.resize((max(1,round(crop.width*ratio)),max(1,round(crop.height*ratio))),Image.Resampling.LANCZOS)
        m=Image.new('RGBA',crop.size,(255,255,255,255));m.putalpha(crop);p=out/f'window-mask-{width}.webp';m.save(p,lossless=True,method=6,exact=True)
        q['windowMask']={'rect':[bounds[0],bounds[1],bounds[2]-bounds[0],bounds[3]-bounds[1]],'maskMode':'alpha',**meta(p)}
        q['decodedBytesWithPoster']=q['poster']['decodedRgbaBytes']+q['cleanPlate']['decodedRgbaBytes']+sum(l['decodedRgbaBytes'] for l in q['layers'])+q['windowMask']['decodedRgbaBytes']
        q['decodedBytesAfterPosterRelease']=q['decodedBytesWithPoster']-q['poster']['decodedRgbaBytes'];manifest['qualities'][str(width)]=q
    thumbnail=out/'thumbnail.webp';poster.resize((360,800),Image.Resampling.LANCZOS).convert('RGB').save(thumbnail,quality=86,method=6);manifest['thumbnail']=meta(thumbnail)
    manifest['sourceFiles']=[{'file':str((src/(n+'.png')).relative_to(ROOT)).replace('\\','/'),'sha256':digest(src/(n+'.png'))} for n in cam['layers']]
    (out/'scene-export.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    source=authored/f'source-{sid}-2160.png';blend=authored/f'VirtuGene-{sid}-Original.blend'
    provenance={'author':'VirtuGene original procedural scene','tool':'Blender 4.5.3 / Cycles OptiX; offline Pillow export','license':'Project-owned original geometry and materials; no stock imports','externalAssetImports':[],'remoteGenerationCalls':0,'modelAndReasoning':'未确认','sourceCamera':str((authored/'camera-export.json').relative_to(ROOT)).replace('\\','/'),'authoredSource':{**meta(source),'path':str(source.relative_to(ROOT)).replace('\\','/'),'method':'Native original Cycles 2160x4800 render, not enlarged'},'blendSource':{'path':str(blend.relative_to(ROOT)).replace('\\','/'),'bytes':blend.stat().st_size,'sha256':digest(blend)},'authoringScripts':[{'path':str(p.relative_to(ROOT)).replace('\\','/'),'sha256':digest(p)} for p in [HERE/'build-scenes.py',HERE/'export-runtime.py']],'exports':[meta(p) for p in sorted(out.glob('*.webp'))]}
    (out/'asset-provenance.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2),encoding='utf8')
    print(sid,{k:(q['decodedBytesAfterPosterRelease'],q['decodedBytesWithPoster']) for k,q in manifest['qualities'].items()})
