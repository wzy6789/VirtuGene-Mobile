import{readFileSync,writeFileSync,mkdirSync}from'node:fs';import{createHash}from'node:crypto';
const out=process.env.VG_SCENE_EVIDENCE??'.tmp-preview/chat-lived-in-20261020';mkdirSync(out,{recursive:true});const json=p=>JSON.parse(readFileSync(p,'utf8')),sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const report={checks:[],scenes:[],model:'未确认',reasoning:'未确认',scope:'Actual binary GLB and native source hashes; fixed-view authored depth volumes with generated photographic artwork, not full PBR reconstruction.'};
const check=(pass,name,detail)=>report.checks.push({pass:!!pass,name,detail});
for(const id of (process.env.VG_SCENE_ASSET_IDS??'guofeng-tea-room,urban-window-seat').split(',')){
 const root='src/assets/chat-scenes/'+id,metadata=json(root+'/scene-realtime.json'),manifest=json(root+'/scene-export.json'),art=metadata.source.art,buffer=readFileSync(root+'/scene.glb');let doc,bin;
 check(buffer.readUInt32LE(0)===0x46546c67&&buffer.readUInt32LE(8)===buffer.length,id+' valid actual GLB header');
 for(let o=12;o<buffer.length;){const n=buffer.readUInt32LE(o),type=buffer.readUInt32LE(o+4);if(type===0x4e4f534a)doc=JSON.parse(buffer.subarray(o+8,o+8+n).toString());if(type===0x004e4942)bin=buffer.subarray(o+8,o+8+n);o+=8+n;}
 const positions=[];let triangles=0;for(const mesh of doc.meshes)for(const primitive of mesh.primitives){const a=doc.accessors[primitive.attributes.POSITION],view=doc.bufferViews[a.bufferView];for(let i=0;i<a.count;i++)positions.push([0,1,2].map(c=>bin.readFloatLE((view.byteOffset??0)+(a.byteOffset??0)+i*(view.byteStride??12)+c*4)));triangles+=(primitive.indices===undefined?a.count:doc.accessors[primitive.indices].count)/3;}
 const spans=[0,1,2].map(c=>Math.max(...positions.map(p=>p[c]))-Math.min(...positions.map(p=>p[c])));
 check(spans.every(n=>n>2),id+' actual non-planar furniture and room depth',spans);
 check(triangles===metadata.triangles&&triangles>=300&&triangles<50000,id+' actual triangle topology agrees with sidecar',{triangles});
 check(doc.cameras.length===1&&doc.cameras[0].type==='perspective'&&Math.abs(doc.cameras[0].perspective.yfov-Math.PI/3)<1e-5,id+' true fixed portrait perspective camera',doc.cameras);
 check(doc.nodes.some(n=>n.name==='VG_ORIGINAL_ROOM_GEOMETRY')&&doc.nodes.some(n=>n.name==='VG_BAKED_DISTANT_BACKGROUND'),id+' separate opaque depth geometry and distant art');
 check(sha(root+'/scene.glb')===metadata.sha256&&sha(`public/chat-scenes/${id}/scene-${metadata.sha256.slice(0,12)}.glb`)===metadata.sha256,id+' immutable local model payload hash');
 check(sha(metadata.source.file)===metadata.source.sha256&&sha(art.file)===art.sha256,id+' source artwork and authored geometry hashes');
 check(art.nativeResolution===true&&art.upscaled===false&&Object.values(manifest.qualities).every(q=>q.poster.width===art.width&&q.poster.height===art.height),id+' runtime texture preserves native artwork resolution without upscaling',{width:art.width,height:art.height});
 const imports=Object.values(manifest.qualities).flatMap(q=>[q.poster,q.cleanPlate,q.windowMask,...q.layers]);check(imports.every(a=>sha(root+'/'+a.file)===a.sha256),id+' every encoded surface and visibility mask matches manifest');
 const mask=Object.values(manifest.qualities)[0].windowMask;check(mask.width<art.width||mask.height<art.height,id+' visibility mask has actual cropped local bounds',mask.rect);
 check(doc.buffers.every(b=>!b.uri)&&!doc.images?.length&&!doc.extensionsRequired?.length,id+' self-contained model requires no external textures or decoder');
 report.scenes.push({id,triangles,bytes:buffer.length,spans,source:metadata.source,materialStrategy:metadata.materialStrategy});
}
report.status=report.checks.every(c=>c.pass)?'pass':'failed';writeFileSync(out+'/asset-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,failed:report.checks.filter(c=>!c.pass)}));if(report.status!=='pass')process.exitCode=1;
