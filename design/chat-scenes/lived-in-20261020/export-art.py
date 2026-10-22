"""Encode native generated art without upscaling; preserve source provenance.

No painted-in particles or UI. This asset remains photographic source art, not
an offline Blender render. Depth/visibility are authored and exported separately.
"""
from pathlib import Path
from PIL import Image
import hashlib,json,sys
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
ids=sys.argv[1:] or ['guofeng-tea-room','urban-window-seat']
for sid in ids:
    source=HERE/(sid+'-source.png');im=Image.open(source).convert('RGB');w,h=im.size
    art={'file':str(source.relative_to(ROOT)).replace('\\','/'),'width':w,'height':h,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'origin':'Built-in image generation, task-authorized original environment asset. Not a Blender render.','nativeResolution':True,'upscaled':False,'model':'未确认','reasoning':'未确认'}
    (HERE/(sid+'-art.json')).write_text(json.dumps(art,ensure_ascii=False,indent=2),encoding='utf8')
    out=ROOT/'src/assets/chat-scenes'/sid;out.mkdir(parents=True,exist_ok=True)
    def meta(path):
        image=Image.open(path);return {'file':path.name,'width':image.width,'height':image.height,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'decodedRgbaBytes':image.width*image.height*4}
    poster=out/f'poster-{w}.webp';im.save(poster,quality=96,method=6)
    thumb=out/'thumbnail.webp';im.resize((360,round(h*360/w)),Image.Resampling.LANCZOS).save(thumb,quality=90,method=6)
    if not (HERE/(sid+'-window-mask.png')).exists():continue
    mask=Image.open(HERE/(sid+'-window-mask.png')).convert('L').point(lambda v:0 if v<8 else 255 if v>247 else v);box=mask.getbbox();assert box
    crop=mask.crop(box);alpha=Image.new('RGBA',crop.size,(255,255,255,255));alpha.putalpha(crop);maskpath=out/f'window-mask-{w}.webp';alpha.save(maskpath,lossless=True,method=6,exact=True)
    # No independent foreground is duplicated: one complete art layer owns the room.
    q={'poster':meta(poster),'cleanPlate':meta(poster),'layers':[],'windowMask':{'rect':[v*1440/w for v in [box[0],box[1],box[2]-box[0],box[3]-box[1]]],**meta(maskpath)}}
    q['decodedBytesWithPoster']=q['poster']['decodedRgbaBytes']+q['windowMask']['decodedRgbaBytes']
    manifest={'schema':1,'sceneId':sid,'designWidth':1440,'designHeight':h*1440/w,'thumbnail':meta(thumb),'qualities':{str(w):q},'windowPolygon':[],'lightRect':[0,1200,600,1200],'provenance':art['origin'],'compositeStrategy':'One complete photographic artwork, no detached foreground layers; actual geometry supplies realtime depth and exported compatibility mask.','cupMouth':[320,2260] if sid=='guofeng-tea-room' else [275,2600]}
    (out/'scene-export.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    (out/'asset-provenance.json').write_text(json.dumps({'art':art,'encoding':'Lossy WebP quality96 at source native resolution; no upscale, no image repaint, no global blur.','depth':str((HERE/(sid+'-depth.blend')).relative_to(ROOT)).replace('\\','/'),'promptFile':'design/chat-scenes/lived-in-20261020/prompts.json'},ensure_ascii=False,indent=2),encoding='utf8')
    print(sid,w,h,'native art + real depth mask exported',flush=True)
