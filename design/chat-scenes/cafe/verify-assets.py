"""Small offline asset checks; does not start the app or call model APIs."""
from pathlib import Path
from PIL import Image,ImageChops,ImageStat
import json,hashlib
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
checks=[]
def check(name,passed,**facts):
    checks.append({'name':name,'pass':bool(passed),**facts})
    if not passed:raise AssertionError(name)
for variant in ['cafe-afternoon','cafe-rain-night']:
    folder=ROOT/'src/assets/chat-scenes'/variant
    meta=json.loads((folder/'scene-export.json').read_text(encoding='utf8'))
    for quality,q in meta['qualities'].items():
        decoded=0
        for f in [q['poster'],q['cleanPlate'],q['windowMask'],*q['layers']]:
            im=Image.open(folder/f['file']).convert('RGBA');decoded+=im.width*im.height*4
            check(variant+'/'+quality+'/'+f['file']+'/dimensions',im.size==(f['width'],f['height']))
            check(variant+'/'+quality+'/'+f['file']+'/hash',hashlib.sha256((folder/f['file']).read_bytes()).hexdigest()==f['sha256'])
        check(variant+'/'+quality+'/decoded-cost',decoded==q['decodedBytesWithPoster'],bytes=decoded)
        check(variant+'/'+quality+'/local-window-mask',q['windowMask']['width']<q['width'] and q['windowMask']['height']<q['height'])
        base=Image.open(folder/q['cleanPlate']['file']).convert('RGBA')
        for layer in q['layers']:
            im=Image.open(folder/layer['file']).convert('RGBA');x,y=layer['rect'][:2];ratio=int(quality)/1440
            base.alpha_composite(im,(round(x*ratio),round(y*ratio)))
        poster=Image.open(folder/q['poster']['file']).convert('RGBA')
        diff=ImageChops.difference(base.convert('RGB'),poster.convert('RGB'))
        mean=sum(ImageStat.Stat(diff).mean)/3
        check(variant+'/'+quality+'/lossy-neutral-match',mean<3.5,meanAbsoluteRgbDifference=round(mean,4),maxChannelDifference=max(v[1] for v in diff.getextrema()))
    check(variant+'/same-camera-and-size',meta['designWidth']==1440 and meta['designHeight']==3200 and meta['camera']['lens']==33)
    check(variant+'/cup-anchor-in-cup',200<meta['cupMouth'][0]<225 and 2230<meta['cupMouth'][1]<2250)
window=Image.open(HERE/'window-occlusion-mask.png').convert('L')
casing=Image.open(HERE/'casing-occlusion-mask.png').convert('L')
check('rain/banquette-excluded',window.getpixel((800,1700))<16)
check('rain/visible-window-included',window.getpixel((1050,1400))>239)
check('casing/banquette-occludes-sill',casing.getpixel((800,1770))<16)
result={'status':'pass','checkCount':len(checks),'checks':checks,'scope':'Offline authored assets only; no mobile GPU, no actual app interaction','workingDirectory':str(ROOT),'model':'未确认','reasoning':'未确认'}
(HERE/'asset-checks.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print('PASS',len(checks),'asset checks')
