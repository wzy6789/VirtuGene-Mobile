"""Independent actual-file composite/source audit (read-only runtime assets).

This reconstructs the exported WebP resources rather than trusting exporter
metadata. PNG source/composite is lossless; lossy WebP and separately sampled
native2160 source are compared with explicit, recorded tolerances.
"""
from pathlib import Path
from PIL import Image,ImageChops,ImageStat,ImageFilter,ImageOps
import hashlib,json
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
SIZE=(1440,3200);RESULT={}
TOLERANCES={'source':{'meanAbsRgb':1.5,'p99':12,'fractionChannelsOver16':.005},
    'webp':{'meanAbsRgb':1,'p99':8,'fractionChannelsOver16':.001}}

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def stats(a,b):
    d=ImageChops.difference(a.convert('RGB'),b.convert('RGB'))
    histogram=d.histogram();combined=[sum(histogram[i+j*256] for j in range(3)) for i in range(256)]
    total=sum(combined);c=0;percentile={}
    for value,count in enumerate(combined):
        c+=count
        for name,threshold in [('p95',.95),('p99',.99),('p999',.999)]:
            if name not in percentile and c>=total*threshold:percentile[name]=value
    return {'meanAbsRgb':sum(ImageStat.Stat(d).mean)/3,'maxAbsChannel':max(v[1] for v in d.getextrema()),
        **percentile,'fractionChannelsOver16':sum(combined[17:])/total,'rgbDifferenceBBox':d.getbbox()},d

def within(metrics,kind):return all(metrics[key]<=limit for key,limit in TOLERANCES[kind].items())

# Guard against the former RGBA-alpha blind spot without editing any assets.
zero=Image.new('RGBA',(2,2),(0,0,0,255));changed=zero.copy();changed.putpixel((0,0),(255,0,0,255))
assert stats(zero,changed)[0]['maxAbsChannel']==255

for sid in ['snow-study','mist-coast']:
    origin=HERE/sid;runtime=ROOT/'src/assets/chat-scenes'/sid
    manifest=json.loads((runtime/'scene-export.json').read_text(encoding='utf8'))
    metadata=json.loads((origin/'camera-export.json').read_text(encoding='utf8'))
    source_path=origin/f'source-{sid}-2160.png'
    source=Image.open(source_path).convert('RGB');native=source.resize(SIZE,Image.Resampling.LANCZOS)
    reconstructed=Image.open(origin/'base.png').convert('RGBA')
    ordered=['casing','foreground','table'];coverage={}
    for name in ordered:
        layer=Image.open(origin/(name+'-occluded.png')).convert('RGBA')
        reconstructed.alpha_composite(layer)
        visibility=Image.open(origin/(name+'-visibility.png')).convert('L')
        # Pixels outside the real physical target's visible area are forbidden.
        outside=ImageChops.multiply(layer.getchannel('A'),visibility.point(lambda p:255 if p==0 else 0))
        coverage[name]={'visibleLayerPixels':sum(layer.getchannel('A').histogram()[1:]),
            'coveredTargetPixelsOutsideVisibility':sum(outside.histogram()[1:])}
        assert coverage[name]['coveredTargetPixelsOutsideVisibility']==0
    poster=Image.open(origin/'poster-composite.png').convert('RGB')
    png_stats,_=stats(reconstructed,poster)
    assert png_stats['maxAbsChannel']==0,png_stats
    source_stats,source_diff=stats(reconstructed,native)
    assert within(source_stats,'source'),(sid,'native source drift',source_stats)
    source_diff.point(lambda p:min(255,p*8)).resize((450,1000),Image.Resampling.LANCZOS).save(origin/'source-vs-composite-difference-x8.png')
    # Three image rows show source, uncompressed reconstruction and amplified
    # differences without a camera crop, blur, shift or colour alignment.
    contact=Image.new('RGB',(1350,1000),'#18202a')
    for x,im in enumerate([native,reconstructed.convert('RGB'),source_diff.point(lambda p:min(255,p*8))]):
        contact.paste(im.resize((450,1000),Image.Resampling.LANCZOS),(x*450,0))
    contact.save(origin/'source-composite-proof.png')
    quality_results={}
    for quality,q in manifest['qualities'].items():
        actual=Image.open(runtime/q['cleanPlate']['file']).convert('RGBA').resize(SIZE,Image.Resampling.LANCZOS)
        alpha_modes={};static={}
        for name in ordered:
            item=next(l for l in q['layers'] if l['id']==name)
            im=Image.open(runtime/item['file']);alpha_modes[name]=im.mode
            assert im.mode=='RGBA',(sid,quality,name,im.mode)
            assert item['depthFactor']==0 and item['maxOffsetPx']==0,(sid,quality,name)
            static[name]={'depthFactor':item['depthFactor'],'maxOffsetPx':item['maxOffsetPx']}
            x,y,w,h=item['rect'];layer=im.resize((w,h),Image.Resampling.LANCZOS)
            actual.alpha_composite(layer,(x,y))
        actual_poster=Image.open(runtime/q['poster']['file']).convert('RGB').resize(SIZE,Image.Resampling.LANCZOS)
        actual_stats,actual_diff=stats(actual,actual_poster)
        assert within(actual_stats,'webp'),(sid,quality,'runtime poster drift',actual_stats)
        path=origin/f'webp-{quality}-reconstruction.png';actual.save(path)
        actual_diff.point(lambda p:min(255,p*8)).resize((450,1000),Image.Resampling.LANCZOS).save(origin/f'webp-{quality}-poster-difference-x8.png')
        qm=q['windowMask'];mask=Image.open(runtime/qm['file'])
        assert mask.mode=='RGBA' and qm['maskMode']=='alpha'
        x,y,w,h=qm['rect'];designmask=Image.new('L',SIZE,0);designmask.paste(mask.getchannel('A').resize((w,h),Image.Resampling.LANCZOS),(x,y))
        # Same design coordinates for all masks/layers. Full opaque interiors
        # must remain disjoint after filtering, independent of descriptor text.
        mask_interior=designmask.point(lambda p:255 if p>250 else 0).filter(ImageFilter.MinFilter(3))
        intersections={}
        for name in ordered:
            item=next(l for l in q['layers'] if l['id']==name);x,y,w,h=item['rect']
            alpha=Image.new('L',SIZE,0);alpha.paste(Image.open(runtime/item['file']).getchannel('A').resize((w,h),Image.Resampling.LANCZOS),(x,y))
            solid=alpha.point(lambda p:255 if p>250 else 0).filter(ImageFilter.MinFilter(3))
            intersections[name]=sum(ImageChops.multiply(mask_interior,solid).histogram()[1:])
            assert intersections[name]==0,(sid,quality,name,intersections[name])
        quality_results[quality]={'actualLayerModes':alpha_modes,'staticDepth':static,
            'posterVsActualReconstruction':actual_stats,'opaqueForegroundWindowIntersections':intersections,
            'reconstruction':str(path.relative_to(ROOT)).replace('\\','/')}
    RESULT[sid]={'cameraMatchesSourceMetadata':manifest['camera']==metadata['camera'],
        'losslessPngReconstruction':png_stats,'native2160VsComposite':source_stats,
        'uncompressedForegroundVisibility':coverage,'quality':quality_results,
        'sourceSha256':sha(source_path),'posterCompositeSha256':sha(origin/'poster-composite.png'),
        'comparisonPolicy':'No alignment/colour correction. PNG exact; WebP lossy and independently sampled native2160 are metric comparisons, not pixel equality.',
        'tolerances':TOLERANCES,
        'androidGpuValidation':False}
    assert RESULT[sid]['cameraMatchesSourceMetadata']
    # A real missing-foreground regression must be rejected, not merely render
    # another valid picture. This is an in-memory mutation of the actual layers.
    missing_table=Image.open(origin/'base.png').convert('RGBA')
    for name in ['casing','foreground']:missing_table.alpha_composite(Image.open(origin/(name+'-occluded.png')).convert('RGBA'))
    missing_stats,_=stats(missing_table,poster)
    assert not within(missing_stats,'webp'),(sid,'negative control failed to detect missing table')
    RESULT[sid]['negativeControls']={'oneRgbPixelChangeDetected':True,'missingActualTableRejected':True,
        'missingTableDifference':missing_stats}
    motion=manifest['motion']
    assert all(motion[k]==0 for k in ['baseMaxDesignPixels','casingMaxDesignPixels','foregroundMaxDesignPixels','tableMaxDesignPixels'])
    RESULT[sid]['manifestAndAllLayerDepthRulesAgree']=True
(HERE/'composite-audit.json').write_text(json.dumps(RESULT,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({sid:{'source':v['native2160VsComposite'],'webp':{q:x['posterVsActualReconstruction'] for q,x in v['quality'].items()}} for sid,v in RESULT.items()},indent=2))
