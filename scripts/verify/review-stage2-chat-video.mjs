import{chromium}from'playwright';import{readFileSync,writeFileSync}from'node:fs';
const out=process.env.VG_VIDEO_REVIEW_OUT??'.tmp-preview/stage2-ui-20261018/S11/chat-handoff',report=JSON.parse(readFileSync(out+'/result.json','utf8')),browser=await chromium.launch({channel:'chrome'}),frames=[];
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.route('http://video.invalid/record.webm',route=>route.fulfill({path:report.video,contentType:'video/webm'}));
 await page.setContent('<style>html,body{margin:0;width:390px;height:844px;background:#10151d}video{display:block;width:390px;height:844px}</style><video muted preload="auto" src="http://video.invalid/record.webm"></video>');await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
 const duration=await page.locator('video').evaluate(video=>video.duration);if(!Number.isFinite(duration))throw Error('Finite duration required');
 for(const[seq,fraction]of [.18,.42,.66,.9].entries()){
  const target=duration*fraction,metadata=await page.locator('video').evaluate((video,target)=>new Promise((resolve,reject)=>{
   let id;const timer=setTimeout(()=>{video.cancelVideoFrameCallback(id);reject(Error('No new decoded playback frame within8s'));},8000);
   const frame=(_,m)=>{if(m.mediaTime>=target){video.pause();clearTimeout(timer);resolve({target,mediaTime:m.mediaTime,presentedFrames:m.presentedFrames,width:m.width,height:m.height});}else id=video.requestVideoFrameCallback(frame);};
   id=video.requestVideoFrameCallback(frame);video.play().catch(reject);
  }),target);
  if(metadata.mediaTime-target>.25)throw Error('Decoded frame too far beyond sample');
  const file=`${out}/decoded-playback-${seq+1}.png`;await page.screenshot({path:file});frames.push({...metadata,file});
 }
 writeFileSync(out+'/decoded-frames.json',JSON.stringify({duration,frames,method:'Sequential muted video review,requestVideoFrameCallback confirms new mediaTime before pause/capture. No seeking,old-frame reuse,or inferred model latency.'},null,2));console.log(JSON.stringify({duration,frames}));
}finally{await browser.close();}
