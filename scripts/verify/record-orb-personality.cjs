const {createRequire}=require('node:module');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=createRequire(path.join(path.dirname(process.execPath),'package.json'))('playwright');
const contrast=process.argv.includes('--contrast');
const output=path.resolve(contrast?'.tmp-preview/orb-transition-601':'.tmp-preview/orb-personality-601');fs.mkdirSync(output,{recursive:true});
const html=fs.readFileSync('docs/prototypes/soul-orb.html');
const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end(html);});
const sequence=contrast?[['idle',900],['sad',1300],['happy',1100],['sleepy',1300],['success',1100],['happy',600],['sad',1300],['surprised',1100],['working',900],['error',900],['thinking',900],['success',1100]]:[['idle',2600],['curious',2800],['listening',3400],['thinking',3400],['working',2600],['happy',2800],['surprised',1900],['shy',2300],['sleepy',3300],['sad',2900],['error',1900],['success',3000]];
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    for(const theme of ['dark','light']){
      const context=await browser.newContext({viewport:{width:390,height:900},reducedMotion:'no-preference',recordVideo:{dir:output,size:{width:390,height:900}}});
      try{
        const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.getByRole('button',{name:'轻轻碰一下小星'}).waitFor();
        if(theme==='light')await page.getByRole('button',{name:'切换预览主题'}).click();
        await page.getByRole('button',{name:'双球同屏',exact:true}).click();await page.evaluate(()=>scrollTo(0,0));
        await page.waitForFunction(()=>soulOrbDemo.activity().clients===2);await page.mouse.move(0,0);
        let id=1;
        for(const [mood,duration] of sequence){
          await page.evaluate(([mood,id])=>soulOrbDemo.cue(mood,id),[mood,id++]);
          await page.waitForTimeout(450);const commits=await page.evaluate(()=>soulOrbDemo.commits());
          await page.waitForTimeout(duration-450);
          if(await page.evaluate(()=>soulOrbDemo.commits())!==commits)throw Error(`Unexpected React frame commits in ${mood}`);
          if(!await page.locator('.orb-pet .vg-soul-orb').evaluate((node,mood)=>node.dataset.orbEmotion===mood,mood))throw Error(`Incorrect mood: ${mood}`);
          if(['idle','listening','happy','sleepy'].includes(mood))await page.screenshot({path:path.join(output,`${mood}-${theme}.png`)});
        }
        if(errors.length)throw Error(errors.join('\n'));
        const video=page.video();await page.close();await context.close();await video.saveAs(path.join(output,`${contrast?'contrast':'personality'}-${theme}.webm`));
        console.log(`Recorded ${theme}: ${contrast?'high-contrast transitions':'twelve moods'}, two sizes, zero React frame commits`);
      }finally{await context.close();}
    }
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
