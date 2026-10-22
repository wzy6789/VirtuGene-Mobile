"""Encode generated source art at its native size; no repaint or upscaling."""
from pathlib import Path
from PIL import Image
import hashlib,json,sys
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
rooms=json.loads((HERE/'rooms.json').read_text('utf8'))
for sid in sys.argv[1:] or rooms:
    cfg=rooms[sid];source=HERE/(sid+'-source.png');im=Image.open(source).convert('RGB');w,h=im.size
    art={'file':source.relative_to(ROOT).as_posix(),'width':w,'height':h,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'origin':'Built-in image generation; original photographic-style environment artwork, not a Blender render.','nativeResolution':True,'upscaled':False,'model':'未确认','reasoning':'未确认'}
    (HERE/(sid+'-art.json')).write_text(json.dumps(art,ensure_ascii=False,indent=2),encoding='utf8')
    out=ROOT/'src/assets/chat-scenes'/sid;out.mkdir(parents=True,exist_ok=True)
    def meta(path):
        image=Image.open(path);return {'file':path.name,'width':image.width,'height':image.height,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'decodedRgbaBytes':image.width*image.height*4}
    poster=out/f'poster-{w}.webp';im.save(poster,quality=96,method=6)
    thumb=out/'thumbnail.webp';im.resize((360,round(h*360/w)),Image.Resampling.LANCZOS).save(thumb,quality=90,method=6)
    maskSource=HERE/(sid+'-window-mask.png')
    if not maskSource.exists():continue
    mask=Image.open(maskSource).convert('L').point(lambda v:0 if v<8 else 255 if v>247 else v);box=mask.getbbox();assert box
    crop=mask.crop(box);alpha=Image.new('RGBA',crop.size,(255,255,255,255));alpha.putalpha(crop);maskpath=out/f'window-mask-{w}.webp';alpha.save(maskpath,lossless=True,method=6,exact=True)
    q={'poster':meta(poster),'cleanPlate':meta(poster),'layers':[],'windowMask':{'rect':[v*1440/w for v in [box[0],box[1],box[2]-box[0],box[3]-box[1]]],**meta(maskpath)}}
    q['decodedBytesWithPoster']=q['poster']['decodedRgbaBytes']+q['windowMask']['decodedRgbaBytes']
    scale=[1440,h*1440/w];light=cfg['lightRect']
    manifest={'schema':1,'sceneId':sid,'designWidth':scale[0],'designHeight':scale[1],'thumbnail':meta(thumb),'qualities':{str(w):q},'windowPolygon':[[u*scale[0],v*scale[1]] for u,v in cfg['opening']],'lightRect':[light[0]*scale[0],light[1]*scale[1],light[2]*scale[0],light[3]*scale[1]],'glass':cfg['glass'],'cupMouth':[cfg['cup'][0]*scale[0],cfg['cup'][1]*scale[1]],'provenance':art['origin'],'compositeStrategy':'Native photographic-style art on independently authored volumetric depth; same camera and semantic window mask, no duplicated foreground.'}
    (out/'scene-export.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    (out/'asset-provenance.json').write_text(json.dumps({'art':art,'encoding':'Native WebP quality96; thumbnail is a downsample. No upscaling or scene repaint.','depth':(HERE/(sid+'-depth.blend')).relative_to(ROOT).as_posix(),'promptFile':'design/chat-scenes/cinematic-20261021/prompts.json'},ensure_ascii=False,indent=2),encoding='utf8')
    print(sid,w,h,'native art and geometry mask exported',flush=True)
