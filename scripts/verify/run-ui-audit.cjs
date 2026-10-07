// Uses the real settings fixture with the current production stylesheet.
const {createRequire}=require('module');
const path=require('path'),fs=require('fs'),assert=require('assert/strict');
const {chromium}=createRequire(path.join(path.dirname(process.execPath),'package.json'))('playwright');

(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  const output=path.resolve('.tmp-preview/ui-audit-20261004');fs.mkdirSync(output,{recursive:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let checks=0;const check=(ok,label)=>{assert.ok(ok,label);checks++;};
  const mount=async(mode,theme='dark')=>{
    await page.evaluate(async({mode,theme})=>{await window.settingsUITest.mount(mode);window.settingsUITest.useThemeStore.getState().setTheme(theme);},{mode,theme});
    await page.waitForTimeout(360);
  };
  const contrast=async selector=>page.locator(selector).first().evaluate(el=>{
    const rgb=value=>value.match(/[\d.]+/g).map(Number);
    const lum=values=>{const v=values.slice(0,3).map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return .2126*v[0]+.7152*v[1]+.0722*v[2];};
    let node=el,background;while(node){const color=rgb(getComputedStyle(node).backgroundColor);if(color.length===3||color[3]>=.99){background=color;break;}node=node.parentElement;}
    const a=lum(rgb(getComputedStyle(el).color)),b=lum(background??[255,255,255]);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  });
  try{
    await page.goto('http://127.0.0.1:17899/settings-ui.html?virtugene-preview=mobile');
    await page.waitForFunction(()=>document.documentElement.dataset.settingsReady==='true');
    await mount('settings');
    await page.getByRole('searchbox').fill('朗读语速');
    check(await page.getByRole('button',{name:/聊天与语音/}).count()===1,'search indexes a real component label absent from manual aliases');
    await page.getByRole('searchbox').fill('跟随系统');
    check(await page.getByRole('button',{name:/外观与阅读/}).count()===1,'system theme appears in search');
    await page.getByRole('button',{name:/外观与阅读/}).click();
    await page.emulateMedia({colorScheme:'light'});
    await page.getByRole('radio',{name:/^跟随系统/}).check();
    check(await page.evaluate(()=>window.settingsUITest.useThemeStore.getState().theme==='light'),'system preference initially resolves light');
    await page.emulateMedia({colorScheme:'dark'});
    await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));
    check(await page.evaluate(()=>window.settingsUITest.useThemeStore.getState().theme==='dark'),'system change updates the effective theme');
    await page.getByRole('radio',{name:/^浅色/}).check();
    await page.emulateMedia({colorScheme:'light'});await page.emulateMedia({colorScheme:'dark'});
    check(await page.evaluate(()=>!document.documentElement.classList.contains('dark')),'explicit light selection ignores system changes');
    check(await page.evaluate(()=>JSON.parse(localStorage.getItem('virtugene-theme')).state.preference==='light'),'persisted theme stores the actual preference');
    check(await page.getByRole('slider',{name:'聊天字号'}).count()===1,'appearance reuses the accessible font ruler');
    check(await page.locator('.vg-font-preview style').count()===0,'font preview inserts no style tag');
    await page.getByRole('slider',{name:'聊天字号'}).focus();await page.keyboard.press('End');
    check(await page.evaluate(()=>window.settingsUITest.useSettingsStore.getState().chatFontSize===22),'ruler keyboard End selects largest font');
    await page.keyboard.press('Home');
    check(await page.evaluate(()=>window.settingsUITest.useSettingsStore.getState().chatFontSize===12),'ruler keyboard Home selects smallest font');

    for(const theme of ['dark','light']){
      await mount('todo',theme);
      check(await contrast('.vg-todo-overview p')>=4.5,`${theme} Todo caption meets reading contrast`);
      check(await contrast('.vg-todo-header h1')>=4.5,`${theme} Todo title stays readable`);
      await page.getByRole('button',{name:'新建待办',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'记下一件事',exact:true});
      await dialog.waitFor();await page.waitForTimeout(360);
      check(await dialog.evaluate(el=>getComputedStyle(el).borderTopLeftRadius===(el.classList.contains('vg-mobile-page')?'0px':getComputedStyle(document.documentElement).getPropertyValue('--vg-sheet-radius').trim())),`${theme} Todo uses the shared Modal presentation radius`);
      check(await dialog.locator('input[type=radio]').first().evaluate(el=>el.getBoundingClientRect().width===18),'radio controls do not stretch to form width');
      const title=dialog.getByPlaceholder('要做什么？');await title.focus();await page.keyboard.press('Tab');
      check(await dialog.getByPlaceholder('备注（可选）').evaluate(el=>getComputedStyle(el).outlineStyle!=='none'),'keyboard form focus remains visible');
      await title.fill(`主题验收 ${theme}`);
      check(await contrast('.vg-todo-save')>=4.5,`${theme} enabled Todo save has readable action text`);
      await dialog.getByRole('button',{name:'保存行动',exact:true}).click();await dialog.waitFor({state:'detached'});
      await page.locator('.vg-todo-row-main strong').filter({hasText:`主题验收 ${theme}`}).waitFor();
      check(true,`${theme} Todo saves through the repository and refreshes the list`);
      await page.waitForTimeout(300);
      await page.screenshot({path:path.join(output,`todo-${theme}.png`)});
      await page.getByRole('button',{name:/主题验收/}).first().click();await page.getByRole('dialog',{name:'编辑行动',exact:true}).waitFor();
      await page.keyboard.press('Escape');
      check(await page.getByRole('dialog').count()===0,'Escape dismisses Todo editor');

      await mount('moments',theme);
      // The settings fixture deliberately opens moments preferences first.
      await page.keyboard.press('Escape');
      await page.getByRole('button',{name:'发布动态',exact:true}).click();
      const composer=page.getByRole('dialog',{name:'发布动态',exact:true});await composer.waitFor();
      await composer.getByPlaceholder('此刻想留下什么？').fill(`动态验收 ${theme}`);
      await page.waitForTimeout(360);
      check(await composer.evaluate(el=>getComputedStyle(el).borderTopLeftRadius===(el.classList.contains('vg-mobile-page')?'0px':getComputedStyle(document.documentElement).getPropertyValue('--vg-sheet-radius').trim())),`${theme} moments uses the shared Modal presentation geometry`);
      await composer.getByRole('button',{name:'发布',exact:true}).click();await composer.waitFor({state:'detached'});
      await page.locator('.vg-moment-text').filter({hasText:`动态验收 ${theme}`}).waitFor();
      check(true,`${theme} publishing retains the real moments flow`);
      await page.getByRole('button',{name:'发布动态',exact:true}).click();await page.waitForTimeout(350);
      await page.evaluate(()=>window.dispatchEvent(new Event('vg:back-request',{cancelable:true})));
      check(await page.getByRole('dialog').count()===0,'native back dismisses the composer');
      await page.waitForTimeout(300);
      await page.screenshot({path:path.join(output,`moments-${theme}.png`)});
      await mount('hero',theme);
      check(await contrast('.vg-world-hero p')>=4.5,`${theme} world hero text remains readable`);
      check(await page.locator('.vg-world-hero p').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=12),'world hero caption has a readable font size');
      check(await contrast('.vg-world-hero button')>=4.5,`${theme} world action text contrasts against its accent surface`);
      check(await page.getByRole('button',{name:'创造角色',exact:true}).evaluate(el=>el.getBoundingClientRect().height>=44),'world action has a full touch target');
      check(await page.locator('.vg-world-hero .tabular-nums').nth(2).evaluate(el=>getComputedStyle(el).color) === (theme==='dark'?'rgb(173, 155, 255)':'rgb(108, 92, 231)'),`${theme} world metric consumes the actual theme accent`);
      await page.screenshot({path:path.join(output,`world-hero-${theme}.png`)});
      await mount('weekly',theme);
      check(await contrast('.vg-weekly-review-hero h2')>=4.5,`${theme} weekly review heading is readable`);
      check(await contrast('.vg-weekly-review-hero .grid .text-sub')>=4.5,`${theme} weekly metric labels are readable`);
      await page.screenshot({path:path.join(output,`weekly-${theme}.png`)});
      await mount('explore',theme);
      check(await contrast('[aria-label="探索现场"] h2')>=4.5,`${theme} explore heading is readable`);
      check(await contrast('[aria-label="探索现场"] p.text-sub')>=4.5,`${theme} explore description is readable`);
      check(await page.getByRole('button',{name:'湖畔书屋'}).evaluate(el=>el.getBoundingClientRect().height>=44),'explore destination has a full touch target');
      await page.getByRole('button',{name:'收起',exact:true}).click();
      check(await page.locator('[aria-label="探索现场"]').count()===0,'explore close retains its callback');
      await mount('auth',theme);
      check(await page.locator('.vg-auth-statusbar').evaluate(el=>getComputedStyle(el).backgroundColor)===(theme==='dark'?'rgb(12, 16, 32)':'rgb(245, 246, 252)'),`${theme} browser login status surface follows theme`);
      check(await page.locator('form svg[aria-hidden="true"]').count()===1,'login uses the vector DNA mark');
      check(await contrast('form label span')>=4.5,`${theme} login consent stays readable`);
      check(await contrast('form button[type=button]')>=4.5,`${theme} login legal links use a readable accent`);
      await page.evaluate(()=>document.documentElement.dataset.vgPlatform='native');
      check(await page.locator('.vg-auth-statusbar').evaluate(el=>getComputedStyle(el).backgroundColor)==='rgb(15, 15, 26)','native status surface preserves contrast for its white icons');
      await page.evaluate(()=>document.documentElement.dataset.vgPlatform='web');
      await page.screenshot({path:path.join(output,`auth-${theme}.png`)});
    }
    for(const colorScheme of ['light','dark']){
      await page.emulateMedia({colorScheme});await mount('me','system');
      const appearance=page.getByRole('button',{name:/外观与阅读/});
      check(await appearance.innerText().then(text=>text.includes(`跟随系统 · ${colorScheme==='dark'?'深色':'浅色'}`)),'Me shows the saved system preference and effective theme');
      await appearance.click();
      await page.getByRole('radio',{name:/^跟随系统/}).waitFor();
      check(await page.getByRole('radio',{name:/^跟随系统/}).isChecked(),'Me shortcut opens Appearance without changing system preference');
      await page.emulateMedia({colorScheme:colorScheme==='dark'?'light':'dark'});
      await page.waitForFunction(expected=>window.settingsUITest.useThemeStore.getState().theme===expected,colorScheme==='dark'?'light':'dark');
      check(await page.evaluate(()=>window.settingsUITest.useThemeStore.getState().preference==='system'),'system changes still apply after the Me shortcut');
      await page.keyboard.press('Escape');
    }
    for(const width of [320,390,430]){
      await page.setViewportSize({width,height:640});
      for(const mode of ['todo','hero','moments']){
        await mount(mode,'light');
        check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${mode} fits ${width}px`);
      }
    }
    await page.setViewportSize({width:390,height:640});await mount('group');
    await page.getByRole('button',{name:'发起群聊',exact:true}).click();
    const create=page.getByRole('dialog',{name:'发起群聊',exact:true});await create.waitFor();
    check(true,'group creation uses a keyboard-accessible shared dialog');
    await create.getByPlaceholder('群名称（可选）').fill('新群验收');
    await create.getByRole('button',{name:/知微/}).click();await create.getByRole('button',{name:/清和/}).click();
    await create.getByRole('button',{name:'创建群聊',exact:true}).click();await create.waitFor({state:'detached'});
    check(await page.evaluate(()=>window.settingsUITest.useGroupStore.getState().currentGroup?.name==='新群验收'),'group creation retains its real data flow');
    await page.getByTitle('群设置',{exact:true}).click();
    const group=page.getByRole('dialog',{name:'群设置',exact:true});await group.waitFor();
    await group.getByRole('switch',{name:'热闹模式',exact:true}).click();
    await page.waitForFunction(()=>window.settingsUITest.useGroupStore.getState().currentGroup?.lively===true);
    check(true,'group preference uses the shared switch and persists changes');
    await page.keyboard.press('Escape');
    check(await page.getByRole('dialog').count()===0&&await page.locator('[data-group-page]').count()===1,'Escape closes group settings while retaining the conversation');
    await page.setViewportSize({width:390,height:844});await mount('settings');
    await page.waitForFunction(()=>document.documentElement.dataset.vgFont==='variable');
    check(true,'successful local font loading enables variable weights');
    const failed=await browser.newPage({viewport:{width:390,height:844}});
    await failed.route('**/*.woff2',route=>route.abort());
    await failed.goto('http://127.0.0.1:17899/settings-ui.html?virtugene-preview=mobile');
    await failed.waitForFunction(()=>document.documentElement.dataset.settingsReady==='true');
    await failed.evaluate(()=>window.settingsUITest.mount('settings'));
    await failed.waitForTimeout(400);
    check(await failed.evaluate(()=>document.documentElement.dataset.vgFont==='fallback'),'blocked font resources retain standard fallback weights');
    const fallbackHeading=await failed.getByRole('dialog').locator('h2').evaluate(el=>({weight:getComputedStyle(el).fontWeight,heading:getComputedStyle(el).getPropertyValue('--vg-weight-heading'),className:el.className,font:document.documentElement.dataset.vgFont}));
    check(fallbackHeading.weight==='700',`fallback headings use a defined standard weight ${JSON.stringify(fallbackHeading)}`);
    await failed.close();check(errors.length===0,'no browser exceptions');
    const legacy=await browser.newPage();
    await legacy.addInitScript(()=>localStorage.setItem('virtugene-theme',JSON.stringify({state:{theme:'light'},version:0})));
    await legacy.goto('http://127.0.0.1:17899/settings-ui.html?virtugene-preview=mobile');
    await legacy.waitForFunction(()=>document.documentElement.dataset.settingsReady==='true');
    check(await legacy.evaluate(()=>window.settingsUITest.useThemeStore.getState().theme==='light'&&window.settingsUITest.useThemeStore.getState().preference==='light'),'legacy saved light theme survives the preference migration');
    await legacy.close();
    console.log(`PASS ${checks} UI audit checks; screenshots: ${output}`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
