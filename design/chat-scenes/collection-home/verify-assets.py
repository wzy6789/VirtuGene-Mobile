"""Validate actual decoded household assets, geometry visibility and native source composition."""
from pathlib import Path
from PIL import Image,ImageChops,ImageStat
import json,hashlib
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2];checks=[]
def check(name,value,detail=None):
    checks.append({'name':name,'pass':bool(value),'detail':detail})
    assert value,(name,detail)
for sid in ['home-bedroom','home-living']:
    authored=HERE/sid;out=ROOT/'src/assets/chat-scenes'/sid;m=json.loads((out/'scene-export.json').read_text())
    source=Image.open(authored/f'source-{sid}-2160.png').convert('RGB')
    check(sid+' native source',source.size==(2160,4800),source.size)
    check(sid+' project source',(authored/f'VirtuGene-{sid}-Original.blend').stat().st_size>100000)
    preview=Image.open(authored/'poster-composite.png').convert('RGB')
    diff=ImageChops.difference(source.resize((1440,3200),Image.Resampling.LANCZOS),preview)
    mean=sum(ImageStat.Stat(diff).mean)/3
    check(sid+' independent native source and runtime camera agree',mean<2,mean)
    sheet=Image.new('RGB',(1440*3,3200));sheet.paste(source.resize((1440,3200),Image.Resampling.LANCZOS),(0,0));sheet.paste(preview,(1440,0));sheet.paste(diff.point(lambda x:min(255,x*8)),(2880,0));sheet.resize((1080,800),Image.Resampling.LANCZOS).save(authored/'source-composite-proof.png')
    for width,q in m['qualities'].items():
        images=[q['poster'],q['cleanPlate'],q['windowMask'],*q['layers']]
        for asset in images:
            p=out/asset['file'];im=Image.open(p)
            check(sid+'/'+asset['file']+' file hash',hashlib.sha256(p.read_bytes()).hexdigest()==asset['sha256'])
            check(sid+'/'+asset['file']+' actual dimensions',im.size==(asset['width'],asset['height']))
        check(sid+'/'+width+' decoded memory',sum(a['width']*a['height']*4 for a in images)<=64*1024*1024,q['decodedBytesWithPoster'])
        check(sid+'/'+width+' complete opaque clean plate',Image.open(out/q['cleanPlate']['file']).convert('RGBA').getextrema()[3]==(255,255))
        check(sid+'/'+width+' static overlap safety',all(l['depthFactor']==0 and l['maxOffsetPx']==0 for l in q['layers']))
        base=Image.open(out/q['cleanPlate']['file']).convert('RGBA');w,h=base.size
        mask=Image.new('L',(w,h),0);x,y,_,_=q['windowMask']['rect'];mask.paste(Image.open(out/q['windowMask']['file']).getchannel('A'),(round(x*w/1440),round(y*h/3200)))
        for l in q['layers']:
            im=Image.open(out/l['file']).convert('RGBA');x,y,_,_=l['rect'];point=(round(x*w/1440),round(y*h/3200));base.alpha_composite(im,point)
            full=Image.new('L',(w,h),0);full.paste(im.getchannel('A'),point)
            overlap=ImageChops.multiply(full.point(lambda v:255 if v>248 else 0),mask.point(lambda v:255 if v>248 else 0))
            check(sid+'/'+width+'/'+l['id']+' effect occlusion',overlap.getbbox() is None)
        diff=ImageChops.difference(base.convert('RGB'),Image.open(out/q['poster']['file']).convert('RGB'));mean=sum(ImageStat.Stat(diff).mean)/3
        check(sid+'/'+width+' actual WebP neutral composite',mean<3,mean)
    check(sid+' thumbnail',Image.open(out/m['thumbnail']['file']).size==(360,800))
    check(sid+' truthful steam anchor',('cupMouth' in m)==(sid=='home-living'))
(HERE/'asset-checks.json').write_text(json.dumps({'status':'pass','checks':checks,'limitations':'Decoded-pixel estimates, not Android memory measurements.'},indent=2),encoding='utf-8')
print('PASS',len(checks),'household scene checks')
