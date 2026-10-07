import {createRequire} from 'node:module';
import {join,dirname,resolve} from 'node:path';
import {mkdirSync} from 'node:fs';
const {chromium}=createRequire(join(dirname(process.execPath),'package.json'))('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:430,height:860},isMobile:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4174/?virtugene-preview=mobile');
  await page.getByRole('textbox',{name:'消息内容'}).waitFor();
  await page.getByText('把报告给我吧，我陪你看。最费神的那段先拆开。',{exact:true}).waitFor();
  await page.waitForTimeout(800);
  mkdirSync('.tmp-preview/chat-effect',{recursive:true});
  await page.screenshot({path:'.tmp-preview/chat-effect/software.png'});
  await page.getByRole('button',{name:'俏皮',exact:true}).click();
  await page.getByText('报告给我看看，先揪最难缠的那段。今晚不搞全盘大扫除。',{exact:true}).waitFor();
  if(errors.length)throw Error(errors.join('\n'));
  console.log('Actual ChatWindow preview and personality switching pass. Screenshot: '+resolve('.tmp-preview/chat-effect/software.png'));
}finally{await browser.close();}
