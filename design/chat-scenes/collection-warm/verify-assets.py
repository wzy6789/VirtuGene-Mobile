"""Verify actual pixels, hashes, geometry masks and decoded memory, not claims."""
from pathlib import Path
from PIL import Image,ImageChops,ImageStat
import json,hashlib,sys
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
proof=[]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
for sid in (sys.argv[1:] or ['hearth-cabin','night-train']):
    authored=HERE/sid;out=ROOT/'src'/'assets'/'chat-scenes'/sid
    manifest=json.loads((out/'scene-export.json').read_text(encoding='utf8'))
    prov=json.loads((out/'asset-provenance.json').read_text(encoding='utf8'))
    assert prov['remoteGenerationCalls']==0 and prov['externalAssetImports']==[]
    with Image.open(authored/f'source-{sid}-2160.png') as source:assert source.size==(2160,4800)
    assert sha(authored/f'VirtuGene-{sid}-Original.blend')==prov['blendSource']['sha256']
    imgs={n:Image.open(authored/'renders'/(n+'.png')).convert('RGBA') for n in ['base','casing','foreground','table']}
    # Regression: independent train curtain must not paint over the nearer
    # upholstered bench. A raw transparent layer alone cannot prove depth.
    foreground_visible=Image.open(authored/'foreground-occlusion-mask.png').convert('L').point(lambda v:0 if v<8 else (255 if v>247 else v))
    imgs['foreground'].putalpha(ImageChops.multiply(imgs['foreground'].getchannel('A'),foreground_visible))
    visible=Image.open(authored/'casing-occlusion-mask.png').convert('L').point(lambda v:0 if v<8 else (255 if v>247 else v))
    imgs['casing'].putalpha(ImageChops.multiply(imgs['casing'].getchannel('A'),visible))
    composite=imgs['base'].copy()
    for n in ['casing','foreground','table']:composite.alpha_composite(imgs[n])
    assert composite.getextrema()[3]==(255,255)
    assert ImageChops.difference(composite,Image.open(authored/'poster-composite.png').convert('RGBA')).getbbox() is None
    for k,q in manifest['qualities'].items():
        files=[q['poster'],q['cleanPlate'],*q['layers'],q['windowMask']]
        for f in files:
            path=out/f['file'];assert sha(path)==f['sha256']
            with Image.open(path) as im:
                assert im.size==(f['width'],f['height']);assert im.width*im.height*4==f['decodedRgbaBytes']
        assert sum(f['decodedRgbaBytes'] for f in files)==q['decodedBytesWithPoster']
        assert q['decodedBytesWithPoster']<=64*1024*1024
        mask=Image.open(out/q['windowMask']['file']).convert('RGBA').getchannel('A')
        zeros=mask.histogram()[0];whites=mask.histogram()[255]
        assert zeros>0 and whites>0 and mask.getbbox() is not None
        handoff=Image.open(out/q['cleanPlate']['file']).convert('RGBA')
        ratio=int(k)/1440
        for f in q['layers']:
            xy=(round(f['rect'][0]*ratio),round(f['rect'][1]*ratio));handoff.alpha_composite(Image.open(out/f['file']).convert('RGBA'),xy)
        # Export compression yields minor high-frequency differences at the
        # layered handoff. Quantify them; do not pretend encoded files match.
        diff=ImageChops.difference(handoff.convert('RGB'),Image.open(out/q['poster']['file']).convert('RGB'))
        err=sum(ImageStat.Stat(diff).mean)/3
        assert err<6,(sid,k,err)
        proof.append({'scene':sid,'quality':k,'decodedBytesWithPoster':q['decodedBytesWithPoster'],'decodedBytesAfterPosterRelease':q['decodedBytesAfterPosterRelease'],'maskTransparentPixels':zeros,'maskOpaquePixels':whites,'webpCompositeMeanChannelDifference':round(err,5),'nativeSource':[2160,4800],'exactUncompressedNeutralComposite':True})
    thumb=manifest['thumbnail'];assert thumb['width']==360 and thumb['height']==800 and sha(out/thumb['file'])==thumb['sha256']
(HERE/'asset-verification.json').write_text(json.dumps({'passed':True,'results':proof},indent=2),encoding='utf8')
print(json.dumps({'passed':True,'results':proof},indent=2))
