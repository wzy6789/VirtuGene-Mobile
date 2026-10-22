"""Sequential GPU export jobs; no parallel GPU processes, no remote calls."""
import subprocess,time,json,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]
BLENDER=Path('C:/Users/34568/.cache/virtugene-tools/blender-4.5.3-windows-x64/blender.exe')
records=[]
for sid in ['home-bedroom','home-living']:
    for flag in ['--export','--mask','--source']:
        path=HERE/sid/(flag[2:]+'.log');start=time.time()
        with path.open('wb') as log:
            p=subprocess.Popen([str(BLENDER),'-b','--python',str(HERE/'build-scenes.py'),'--','--scene',sid,flag],cwd=ROOT,stdout=log,stderr=subprocess.STDOUT)
            print(json.dumps({'scene':sid,'job':flag,'pid':p.pid,'status':'running'}),flush=True)
            rc=p.wait()
        records.append({'scene':sid,'job':flag,'pid':p.pid,'exitCode':rc,'seconds':round(time.time()-start,2),'log':str(path)})
        (HERE/'render-jobs.json').write_text(json.dumps(records,indent=2),encoding='utf8')
        print(json.dumps(records[-1]),flush=True)
        if rc:sys.exit(rc)
