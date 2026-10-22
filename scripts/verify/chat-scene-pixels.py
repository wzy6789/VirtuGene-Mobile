"""Check screenshot pixels without altering the images or disabling scene effects."""
import json,re,os
from pathlib import Path
from PIL import Image

root=Path(os.environ.get('VG_SCENE_EVIDENCE','.tmp-preview/chat-scene-plan-20261019/review'))
report=json.loads((root/'result.json').read_text(encoding='utf-8'))
def luminance(rgb):
    values=[v/255 for v in rgb]
    values=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in values]
    return sum(v*w for v,w in zip(values,[.2126,.7152,.0722]))
checks=[]
for group in report['contrast']:
    image=Image.open(root/('contrast-'+group['name']+'.png')).convert('RGB')
    for row in group['rows']:
        if not row['body'] or not row['sampleVisible']:continue
        x,y=round(row['sample']['x']*2),round(row['sample']['y']*2)
        pixel=image.getpixel((x,y))
        expected=row['background'][:3]
        error=max(abs(pixel[i]-expected[i]) for i in range(3))
        foreground=[float(v) for v in re.findall(r'[\d.]+',row['color'])[:3]]
        a,b=luminance(pixel),luminance(foreground)
        ratio=(max(a,b)+.05)/(min(a,b)+.05)
        checks.append({'group':group['name'],'point':[x,y],'screenshotPixel':pixel,'expectedOpaqueSurface':expected,'maximumChannelError':error,'contrast':ratio,'pass':error<=3 and ratio>=7})
result={'status':'pass' if checks and all(row['pass'] for row in checks) else 'failed','checks':checks,'scope':'Actual visible bubble padding pixels at 2x DPR; sticky-header-occluded samples excluded by elementFromPoint. Text colors from actual computed DOM styles. Auxiliary token ratios separately in review/result.json.'}
(root/'pixel-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':result['status'],'checks':len(checks),'minimumRatio':min(row['contrast'] for row in checks)},ensure_ascii=False))
raise SystemExit(0 if result['status']=='pass' else 1)
