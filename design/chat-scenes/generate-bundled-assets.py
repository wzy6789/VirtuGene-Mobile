"""Create explicit local asset imports from the single product scene catalog.

Vite and the isolated actual-component esbuild preview both consume this file;
importing a URL never requests or decodes unselected posters.
"""
from pathlib import Path
import json,re,hashlib,shutil
ROOT=Path(__file__).resolve().parents[2]
ids=re.findall(r"id:'([^']+)'",(ROOT/'src/lib/chat-scene/scene-catalog.ts').read_text(encoding='utf-8'))
assert len(ids)==len(set(ids)) and ids
imports=['// Generated from the scene catalog and verified local manifests. URL imports do not load images.'];entries=[]
for i,sid in enumerate(ids):
    d=ROOT/'src/assets/chat-scenes'/sid;m=json.loads((d/'scene-export.json').read_text(encoding='utf-8'))
    assert m['sceneId']==sid
    imports.append(f"import metadata{i} from '../../assets/chat-scenes/{sid}/scene-export.json';")
    images=[m['thumbnail']]
    for row in m['qualities'].values():images.extend([row['poster'],row['cleanPlate'],row['windowMask'],*row['layers']])
    files=sorted({im['file'] for im in images});urls=[]
    for im in images:
        data=(d/im['file']).read_bytes()
        assert len(data)==im['bytes'] and hashlib.sha256(data).hexdigest()==im['sha256'],(sid,im['file'])
    for j,f in enumerate(files):
        imports.append(f"import image{i}_{j} from '../../assets/chat-scenes/{sid}/{f}';")
        urls.append(f"    '{f}':image{i}_{j},")
    realtime=d/'scene-realtime.json'
    tail=''
    if realtime.exists():
        imports.append(f"import realtimeMeta{i} from '../../assets/chat-scenes/{sid}/scene-realtime.json';")
        rt=json.loads(realtime.read_text(encoding='utf-8'));model=d/rt['file']
        assert hashlib.sha256(model.read_bytes()).hexdigest()==rt['sha256']
        filename='scene-'+rt['sha256'][:12]+'.glb'
        runtime=ROOT/'public/chat-scenes'/sid/filename;runtime.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(model,runtime)
        for old in runtime.parent.glob('scene-*.glb'):
            assert old.resolve().is_relative_to((ROOT/'public/chat-scenes').resolve())
            if old.name!=filename:old.unlink()
        tail=f",realtime:{{metadata:realtimeMeta{i},model:(import.meta.env.BASE_URL??'./')+'chat-scenes/{sid}/{filename}'}}"
    entries.append('  {metadata:metadata'+str(i)+',urls:{\n'+'\n'.join(urls)+'\n  }'+tail+'},')
(ROOT/'src/lib/chat-scene/scene-bundled-assets.ts').write_text('\n'.join(imports)+'\nexport const sceneExports = [\n'+'\n'.join(entries)+'\n];\n',encoding='utf-8')
print('Integrated',len(ids),'scenes with verified file hashes')
