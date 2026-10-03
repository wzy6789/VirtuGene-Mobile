const { createRequire } = require('module');
const path = require('path');
const { chromium } = createRequire(path.join(path.dirname(process.execPath),'package.json'))('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:1480,height:850},deviceScaleFactor:1});
 await page.goto('file:///F:/VirtuGene-Mobile/scripts/verify/secretary-avatars.html');
 await page.locator('img').evaluateAll(async images=>{await Promise.all(images.map(image=>image.decode()));});
 await page.screenshot({path:'F:/VirtuGene-Mobile/scripts/verify/secretary-avatars.png',fullPage:true});
 console.log('10 portraits decoded, gallery screenshot saved');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
