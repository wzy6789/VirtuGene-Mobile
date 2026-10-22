import {readFileSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const reportPath=process.argv[2];if(!reportPath)throw Error('Pass an actual mobile preview report');
const targets=process.argv.slice(3).map(Number);if(targets.length&&!(targets.length===2&&targets.every(Number.isFinite)&&targets[0]<targets[1]))throw Error('Optional targets must be two increasing seconds');
const report=JSON.parse(readFileSync(reportPath,'utf8'));if(!report.complete||!report.video||!report.videoTimeline)throw Error('A complete recording with timeline markers is required');
const video=readFileSync(report.video),server=createServer((req,res)=>{if(req.url==='/video.webm'){
 res.setHeader('Content-Type','video/webm');res.setHeader('Accept-Ranges','bytes');
 const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??'');
 if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),video.length-1):video.length-1;res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${video.length}`,'Content-Length':end-start+1});res.end(video.subarray(start,end+1));}
 else{res.setHeader('Content-Length',video.length);res.end(video);}
}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body style="margin:0"><video muted preload="auto" width="390" height="844" src="/video.webm"></video></body></html>');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true}),out=dirname(resolve(reportPath));
try{
 const page=await browser.newPage({viewport:{width:390,height:844},permissions:[]});await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
 const duration=await page.evaluate(()=>document.querySelector('video').duration),frames=[];
 const candidates=targets.length?[['before-send',targets[0]*1000],['first-body',targets[1]*1000]]:[['before-send',report.videoTimeline.beforeSendMs-180],['first-body',report.videoTimeline.firstBodyMs-100]];
 for(const [label,ms] of candidates){
  const target=Math.max(0.04,Math.min(ms/1000,duration-.08));
  const decoded=await page.evaluate(target=>new Promise((resolve,reject)=>{
   const video=document.querySelector('video');let settled=false;const seen=[];
   const timeout=setTimeout(()=>{settled=true;reject(Error('No matching decoded frame '+JSON.stringify({target,currentTime:video.currentTime,duration:video.duration,readyState:video.readyState,seen})));},10000);
   const callback=async (_now,metadata)=>{
    if(settled)return;seen.push(metadata.mediaTime);
    if(Math.abs(metadata.mediaTime-target)>.12){video.requestVideoFrameCallback(callback);return;}
    // The decoded-frame callback may precede readyState's seek completion.
    // Retain its verified mediaTime, then wait for that same paused seek to finish.
    if(video.seeking)await new Promise(resolve=>video.addEventListener('seeked',resolve,{once:true}));
    await new Promise(resolve=>requestAnimationFrame(resolve));
    if(video.readyState<2||Math.abs(video.currentTime-target)>.12)return;
    settled=true;clearTimeout(timeout);
    const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);
    resolve({target,currentTime:video.currentTime,mediaTime:metadata.mediaTime,presentedFrames:metadata.presentedFrames,width:video.videoWidth,height:video.videoHeight,png:canvas.toDataURL('image/png').split(',')[1]});
   };
   video.requestVideoFrameCallback(callback);video.currentTime=target;
  }),target);
  const png=Buffer.from(decoded.png,'base64');delete decoded.png;
  const path=join(out,'decoded-'+label+'.png');writeFileSync(path,png);frames.push({label,path,...decoded,sha256:createHash('sha256').update(png).digest('hex')});
 }
 if(frames[0].mediaTime>=frames[1].mediaTime||frames[0].sha256===frames[1].sha256)throw Error('Recording did not produce distinct increasing decoded frames');
 const evidence={decodedFramesVerified:true,visualContentsVerified:false,reportPath,video:report.video,videoSha256:createHash('sha256').update(video).digest('hex'),duration,frames,targetsManuallySelected:!!targets.length,method:'requestVideoFrameCallback metadata.mediaTime checked against seek target plus canvas read of the decoded frame; not seeked alone. Wall-clock markers are approximate and may not align with the recorder timeline. Separate visual audit must confirm before-send/first-body contents. Not actual phone/model timing.',apiCalls:0,audioPlayed:false};
 const path=join(out,'decoded-frames.json');writeFileSync(path,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({evidence:path,duration,frames:frames.map(({label,target,mediaTime})=>({label,target,mediaTime}))}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
