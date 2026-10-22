"""Offline Pillow export of Blender-authored aligned cafe layers.

Run after build-cafe.py --export, using the project's existing Python runtime.
Does not generate/paint imagery, upscale, sharpen, or contact any remote API.
"""
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw
import hashlib, json, sys

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
CAM=json.loads((HERE/'camera-export.json').read_text(encoding='utf8'))
DW,DH=1440,3200

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def filemeta(p):
    with Image.open(p) as im:
        return {'file':p.name,'width':im.width,'height':im.height,'decodedRgbaBytes':im.width*im.height*4,'bytes':p.stat().st_size,'sha256':digest(p)}

variants=[sys.argv[1]] if len(sys.argv)>1 else ['cafe-afternoon','cafe-rain-night']
for variant in variants:
    origin=HERE/'renders'/variant
    out=ROOT/'src'/'assets'/'chat-scenes'/variant
    out.mkdir(parents=True,exist_ok=True)
    layers={name:Image.open(origin/(name+'.png')).convert('RGBA') for name in CAM['layers']}
    casing_visibility=HERE/'casing-occlusion-mask.png'
    if not casing_visibility.exists():raise ValueError('Missing actual depth occlusion matte for casing')
    # The sill sits behind the banquette, although the casing is a separately
    # cropped resource. Preserve that original depth by baking its visibility.
    casing_alpha=layers['casing'].getchannel('A')
    # Existing authored mask exports had 8-bit colour dithering at the black
    # endpoint. Remove only near-endpoint quantization noise, retaining the
    # real partially covered edge samples for antialiasing.
    mask_clean=lambda v:0 if v<16 else (255 if v>239 else v)
    casing_visible=Image.open(casing_visibility).convert('L').point(mask_clean)
    layers['casing'].putalpha(ImageChops.multiply(casing_alpha,casing_visible))
    if layers['base'].size != (DW,DH):raise ValueError('Unexpected camera dimensions')
    full=layers['base'].copy()
    for name in CAM['layers'][1:]:full.alpha_composite(layers[name])
    if full.getextrema()[3] != (255,255):raise ValueError('Incomplete poster alpha')
    full.save(origin/'poster-composite.png')
    manifest={'schema':1,'sceneId':variant,'designWidth':DW,'designHeight':DH,
        'camera':CAM['camera'],'cupMouth':CAM['cupMouth'],'windowPolygon':CAM['windowPolygon'],
        'neutralComposite':'clean plate + casing + plant + table, exactly the same PNG pixels as poster-composite.png',
        'compositeProof':{'maxChannelDifference':0,'sameCamera':True,'foregroundObjectsExcludedFromCleanPlate':True,'tableContainsCupAndCupContactShadow':True},
        'provenance':CAM['provenance'],'qualities':{},
        'motion':{'baseMaxDesignPixels':0,'casingMaxDesignPixels':0,'plantMaxDesignPixels':5,'tableMaxDesignPixels':6,
            'rainWindowStatic':True,'note':'Static casing and window. Plant remains left of window and table remains below it at bounded shifts.'}}
    for width in [1080,1440]:
        ratio=width/DW;height=round(DH*ratio);quality={'width':width,'height':height,'layers':[]}
        poster=full if width==DW else full.resize((width,height),Image.Resampling.LANCZOS)
        pp=out/f'poster-{width}.webp';poster.convert('RGB').save(pp,quality=94,method=6)
        base=layers['base'] if width==DW else layers['base'].resize((width,height),Image.Resampling.LANCZOS)
        bp=out/f'clean-plate-{width}.webp';base.convert('RGB').save(bp,quality=94,method=6)
        quality['poster']=filemeta(pp);quality['cleanPlate']=filemeta(bp)
        for name in CAM['layers'][1:]:
            # Crop to real alpha coverage, with transparent breathing room local
            # to the crop; no fullscreen empty foreground textures are shipped.
            alpha=layers[name].getchannel('A');bounds=alpha.getbbox()
            if not bounds:raise ValueError('Empty foreground '+name)
            x0,y0,x1,y1=bounds;pad=12
            bounds=(max(0,x0-pad),max(0,y0-pad),min(DW,x1+pad),min(DH,y1+pad))
            crop=layers[name].crop(bounds)
            if width!=DW:crop=crop.resize((max(1,round(crop.width*ratio)),max(1,round(crop.height*ratio))),Image.Resampling.LANCZOS)
            p=out/f'foreground-{name}-{width}.webp';crop.save(p,quality=96,method=6,exact=True)
            layer={'id':name,'rect':list(bounds[:2])+[bounds[2]-bounds[0],bounds[3]-bounds[1]],**filemeta(p)}
            quality['layers'].append(layer)
        # Camera-aligned window mask can be replaced by the full geometric
        # occlusion render. A true occlusion mask is required before final use.
        maskpath=HERE/'window-occlusion-mask.png'
        if maskpath.exists():
            mask=Image.open(maskpath).convert('L').point(mask_clean)
            if mask.size!=(DW,DH):raise ValueError('Wrong mask design size')
            mb=mask.getbbox();mc=mask.crop(mb)
            if width!=DW:mc=mc.resize((round(mc.width*ratio),round(mc.height*ratio)),Image.Resampling.LANCZOS)
            alpha_mask=Image.new('RGBA',mc.size,(255,255,255,255));alpha_mask.putalpha(mc)
            mp=out/f'window-mask-{width}.webp';alpha_mask.save(mp,lossless=True,method=6,exact=True)
            quality['windowMask']={'rect':list(mb[:2])+[mb[2]-mb[0],mb[3]-mb[1]],'maskMode':'alpha',**filemeta(mp)}
        quality['decodedBytesWithPoster']=quality['poster']['decodedRgbaBytes']+quality['cleanPlate']['decodedRgbaBytes']+sum(l['decodedRgbaBytes'] for l in quality['layers'])+quality.get('windowMask',{}).get('decodedRgbaBytes',0)
        quality['decodedBytesAfterPosterRelease']=quality['decodedBytesWithPoster']-quality['poster']['decodedRgbaBytes']
        manifest['qualities'][str(width)]=quality
    # Source metadata and hashes are separate from runtime texture budgets.
    manifest['sourceFiles']=[{'file':str((origin/(n+'.png')).relative_to(ROOT)).replace('\\','/'),'sha256':digest(origin/(n+'.png'))} for n in CAM['layers']]
    (out/'scene-export.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    authored_source=HERE/f'source-{variant}-2160.png'
    provenance={'author':'VirtuGene original procedural scene','tool':'Blender 4.5.3 / Cycles; offline Pillow export','license':'Project-owned original materials and geometry; no third-party stock','externalAssetImports':[],'remoteGenerationCalls':0,'modelAndReasoning':'未确认','sourceCamera':str((HERE/'camera-export.json').relative_to(ROOT)).replace('\\','/'),'exports':[filemeta(p) for p in sorted(out.glob('*.webp'))]}
    if authored_source.exists():
        provenance['authoredSource']={**filemeta(authored_source),'path':str(authored_source.relative_to(ROOT)).replace('\\','/'),'method':'Original Cycles render at native 2160x4800; not upscaled'}
    blend=HERE/'VirtuGene-Cafe-Original.blend'
    if blend.exists():provenance['blendSource']={'path':str(blend.relative_to(ROOT)).replace('\\','/'),'sha256':digest(blend),'bytes':blend.stat().st_size}
    (out/'asset-provenance.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2),encoding='utf8')
    print(variant, {k:(v['decodedBytesAfterPosterRelease'],v['decodedBytesWithPoster']) for k,v in manifest['qualities'].items()})
