"""Independent pixel, dimensions, budget, crop and true visibility checks."""
from pathlib import Path
from PIL import Image,ImageChops,ImageStat,ImageFilter
import json,hashlib
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2];checks=[]
def check(name,result,details=None):
    checks.append({'name':name,'pass':bool(result),'details':details})
    if not result:raise AssertionError(name+': '+str(details))
for sid in ['snow-study','mist-coast']:
    here=HERE/sid;out=ROOT/'src/assets/chat-scenes'/sid
    m=json.loads((out/'scene-export.json').read_text(encoding='utf8'))
    source=Image.open(here/f'source-{sid}-2160.png')
    check(sid+' native art source',source.size==(2160,4800),source.size)
    check(sid+' retained blend',(here/f'VirtuGene-{sid}-Original.blend').stat().st_size>10000)
    base=Image.open(here/'base.png').convert('RGBA');check(sid+' opaque clean plate',base.getextrema()[3]==(255,255))
    full=base.copy()
    for layer in ['casing','foreground','table']:
        im=Image.open(here/(layer+'-occluded.png')).convert('RGBA');full.alpha_composite(im)
        original=Image.open(here/(layer+'.png')).getchannel('A')
        visible=Image.open(here/(layer+'-visibility.png')).convert('L')
        check(sid+' '+layer+' alpha bounded by original coverage',ImageChops.subtract(im.getchannel('A'),original).getbbox() is None)
        check(sid+' '+layer+' no opaque target behind occluder',ImageChops.multiply(im.getchannel('A'),visible.point(lambda p:255 if p==0 else 0)).getbbox() is None)
    # RGBA getbbox() inspects alpha by default. A difference image has alpha=0,
    # so compare RGB explicitly or real colour differences could be hidden.
    diff=ImageChops.difference(full.convert('RGB'),Image.open(here/'poster-composite.png').convert('RGB'))
    check(sid+' complete neutral PNG composite is exact',diff.getbbox() is None,
        {'maxAbsChannel':max(v[1] for v in diff.getextrema())})
    for width,q in m['qualities'].items():
        cost=0
        for item in [q['poster'],q['cleanPlate'],q['windowMask']]+q['layers']:
            p=out/item['file'];im=Image.open(p)
            check(sid+' '+item['file']+' dimensions',im.size==(item['width'],item['height']))
            check(sid+' '+item['file']+' SHA256',hashlib.sha256(p.read_bytes()).hexdigest()==item['sha256'])
            cost+=im.width*im.height*4
        check(sid+' '+width+' decoded bytes accurate',cost==q['decodedBytesWithPoster'],cost)
        check(sid+' '+width+' decoded memory budget',cost<64*1024*1024,cost)
        check(sid+' '+width+' window is cropped',q['windowMask']['height']<q['height'])
        check(sid+' '+width+' foreground crops bounded',all(l['width']*l['height']<q['width']*q['height'] for l in q['layers']))
        # True window mask must be disjoint from every static foreground that
        # obscures it. Only nonzero *interior* alpha is checked, ignoring AA.
        window=Image.new('L',(1440,3200),0);wm=Image.open(out/q['windowMask']['file']).getchannel('A')
        r=q['windowMask']['rect'];wm=wm.resize((r[2],r[3]),Image.Resampling.NEAREST);window.paste(wm,(r[0],r[1]))
        for l in q['layers']:
            lay=Image.open(out/l['file']).getchannel('A');r=l['rect'];lay=lay.resize((r[2],r[3]),Image.Resampling.NEAREST)
            all_layer=Image.new('L',(1440,3200),0);all_layer.paste(lay,(r[0],r[1]))
            inner_window=window.point(lambda p:255 if p>250 else 0).filter(ImageFilter.MinFilter(3))
            inner_layer=all_layer.point(lambda p:255 if p>250 else 0).filter(ImageFilter.MinFilter(3))
            both=ImageChops.multiply(inner_window,inner_layer)
            # One design-pixel erosion removes only filtered edge coverage;
            # no fully opaque foreground is permitted in the effect interior.
            count=sum(both.histogram()[1:]);check(sid+' '+width+' '+l['id']+' window interior occlusion',count==0,count)
    thumb=Image.open(out/m['thumbnail']['file']);check(sid+' gallery thumbnail',thumb.size==(360,800))
    if sid=='mist-coast':check('coast has no fake steam anchor','cupMouth' not in m)
    else:
        x,y=m['cupMouth'];check('study actual tea anchor on canvas',0<x<1440 and 0<y<3200,[x,y])
(HERE/'asset-checks.json').write_text(json.dumps({'checks':checks,'passed':len(checks),'failed':0,'androidMemoryMeasurement':False},ensure_ascii=False,indent=2),encoding='utf8')
print('PASS',len(checks),'cold collection asset checks')
