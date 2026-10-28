/* VirtuGene star sea: one clock, one pointer source, pooled canvas effects. */
(function () {
  'use strict';
  var root = document.documentElement;
  var motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  var pointerQuery = matchMedia('(hover: hover) and (pointer: fine)');
  function context2d(element){try{return element&&element.getContext('2d',{alpha:true});}catch(_){return null;}}
  var canvas = document.getElementById('vg-dust');
  var ctx = context2d(canvas);
  var nearCanvas=document.getElementById('vg-sparks'),nearCtx=context2d(nearCanvas),readingBoxes=[];
  var lifeCanvas = document.getElementById('life-filament');
  var lifeCtx = context2d(lifeCanvas);
  var field = document.getElementById('vg-field'), halo = document.getElementById('vg-halo');
  var fieldInner = field && field.firstElementChild, haloInner = halo && halo.firstElementChild;
  var nebulaA = document.querySelector('.fx-nebula-a'), nebulaB = document.querySelector('.fx-nebula-b');
  var hero = document.getElementById('hero'), art = document.querySelector('.v7-hero-art');
  var sky = document.querySelector('.hero-cosmos'), progress = document.getElementById('vg-progress');
  var nav = document.getElementById('nav'), toggle = document.getElementById('fx-toggle');
  var showcase = document.querySelector('.v7-showcase');
  var sections = Array.from(document.querySelectorAll('main > section'));
  var preference = true;
  try { preference = localStorage.getItem('virtugene-site-motion') !== 'off'; } catch (_) {}
  var pointer = {x:0,y:0,fx:0,fy:0,hx:0,hy:0,nx:0,ny:0,on:false,quiet:false,speed:0,lastX:0,lastY:0};
  var W=0,H=0,dpr=1,coarse=false,quality=1,frameId=0,last=0,elapsed=0,frameCount=0;
  var measureNeeded=true,scrollY=window.scrollY,maxScroll=1,overlay=false,scene='hero';
  var boxes=[],artBox=null,memoryBox=null,lifeW=0,lifeH=0,heroVisible=true,memoryVisible=false;
  var budget={stars:200,motes:48,trails:24},stars=[],motes=[];
  var trails=Array.from({length:24},function(){return {life:0,x:0,y:0,px:0,py:0,vx:0,vy:0,r:1};});
  var pulses=Array.from({length:4},function(){return {life:0,x:0,y:0};});
  var trailIndex=0,pulseIndex=0,trailWait=0,dropCount=0,slowTotal=0,slowFrames=0,cooldown=0;
  var workMs=0,workMax=0,workSamples=0,intervalSum=0,intervalSamples=0;
  var surface=null,moving=new Set(),lastMode='',lastTone='';
  var sceneDensity=1,flowX=0,flowY=1,memoryReveal=0;
  var palettes={
    hero:{a:'135,108,221',b:'69,108,180',density:1},
    chat:{a:'136,111,193',b:'154,112,80',density:.78},
    voice:{a:'110,94,177',b:'67,111,163',density:.82},
    story:{a:'92,90,192',b:'56,108,175',density:1},
    memory:{a:'153,109,207',b:'87,133,177',density:.84},
    daily:{a:'110,99,168',b:'160,116,78',density:.68},
    gallery:{a:'104,92,168',b:'65,102,156',density:.58},
    download:{a:'126,100,176',b:'78,85,143',density:.38}
  };
  var flows={hero:[1,1],chat:[-.8,-.35],voice:[.35,.4],story:[1.1,.6],memory:[-.4,-.5],daily:[.45,-.25],gallery:[.2,.25],download:[0,.15]};
  var sprites=['216,205,255','224,234,255','150,188,241'].map(function(tint){
    var sprite=document.createElement('canvas');sprite.width=sprite.height=48;
    var g=context2d(sprite);if(!g)return null;var gradient=g.createRadialGradient(24,24,0,24,24,24);
    gradient.addColorStop(0,'rgba('+tint+',1)');gradient.addColorStop(.16,'rgba('+tint+',.65)');gradient.addColorStop(.45,'rgba('+tint+',.12)');gradient.addColorStop(1,'rgba('+tint+',0)');
    g.fillStyle=gradient;g.fillRect(0,0,48,48);return sprite;
  }).filter(Boolean);
  function enabled(){return preference&&!motionQuery.matches&&!!ctx&&sprites.length>0;}
  function canRun(){return enabled()&&!document.hidden&&!overlay&&!!ctx;}
  function absoluteBox(el){if(!el)return null;var r=el.getBoundingClientRect();return {x:r.left,y:r.top+window.scrollY,w:r.width,h:r.height};}
  function seed(){
    var count=Math.round(budget.stars*quality*Math.max(.65,Math.min(1,W*H/(1440*900))));
    stars=Array.from({length:count},function(_,i){return {x:Math.random()*W,y:Math.random()*H,r:.4+Math.random()*1.3,alpha:.18+Math.random()*.5,vx:(Math.random()-.5)*2,vy:.4+Math.random()*2,phase:Math.random()*6.28,sprite:i%3,rank:Math.random()};});
    motes=Array.from({length:Math.round(budget.motes*quality)},function(_,i){return {x:Math.random()*W,y:Math.random()*H,r:1+Math.random()*2,alpha:.09+Math.random()*.18,vx:(Math.random()-.5)*6,vy:-2-Math.random()*4,phase:Math.random()*6.28,sprite:i%3,rank:Math.random()};});
  }
  function measure(){
    measureNeeded=false;var oldW=W,oldH=H,oldCoarse=coarse;
    W=innerWidth;H=innerHeight;scrollY=window.scrollY;coarse=!pointerQuery.matches||W<=650;
    budget=coarse?{stars:80,motes:16,trails:12}:{stars:200,motes:48,trails:24};
    dpr=Math.min(devicePixelRatio||1,coarse?1.25:1.5);
    if(canvas&&(oldW!==W||oldH!==H||canvas.width===0)){canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);ctx&&ctx.setTransform(dpr,0,0,dpr,0,0);}
    if(nearCanvas&&nearCtx&&(oldW!==W||oldH!==H||!nearCanvas.width)){nearCanvas.width=Math.round(W*dpr);nearCanvas.height=Math.round(H*dpr);nearCtx.setTransform(dpr,0,0,dpr,0,0);}
    // Cached document rectangles protect reading and actual product screens. No layout reads in the clock.
    readingBoxes=Array.from(document.querySelectorAll('header,footer,main h1,main h2,main h3,main p,main dl,main figcaption,main a,main strong,main .v7-platform-head>span,main .v7-media-caption,main .v7-hero-facts,main .v7-shot,main .btn,main .v7-feature-tab,main summary,input,textarea')).map(function(el){var b=absoluteBox(el);b.pad=el.matches('.v7-shot')?32:24;return b;}).filter(function(b){return b.w>0&&b.h>0;});
    boxes=sections.map(function(el){var b=absoluteBox(el);b.id=el.id;return b;});
    artBox=absoluteBox(art);memoryBox=absoluteBox(document.querySelector('.v7-memory-media'));
    maxScroll=Math.max(1,document.documentElement.scrollHeight-H);
    if(lifeCanvas&&lifeCtx){var b=lifeCanvas.getBoundingClientRect();lifeW=b.width;lifeH=b.height;lifeCanvas.width=Math.round(lifeW*dpr);lifeCanvas.height=Math.round(lifeH*dpr);lifeCtx.setTransform(dpr,0,0,dpr,0,0);}
    if(oldW!==W||oldH!==H||oldCoarse!==coarse||!stars.length)seed();
    moving.forEach(function(item){item.box=absoluteBox(item.el);});
    updateScene();updateChrome();
  }
  function requestMeasure(){measureNeeded=true;if(!canRun()){measure();draw(0,false);}}
  function updateChrome(){if(progress)progress.style.transform='scaleX('+Math.min(1,Math.max(0,scrollY/maxScroll)).toFixed(4)+')';if(nav)nav.classList.toggle('is-scrolled',scrollY>8);}
  function updateScene(){
    var focus=scrollY+H*.48,chosen=boxes[0];
    for(var i=0;i<boxes.length;i++){if(focus>=boxes[i].y)chosen=boxes[i];}
    var name=chosen?chosen.id:'hero';if(name==='experience')name=showcase?showcase.dataset.showcase:'chat';if(!palettes[name])name='hero';
    scene=name;var palette=palettes[name];if(lastTone!==name){root.style.setProperty('--scene-a',palette.a);root.style.setProperty('--scene-b',palette.b);root.dataset.fxScene=name;lastTone=name;}
    heroVisible=!!artBox&&artBox.y<scrollY+H+80&&artBox.y+artBox.h>scrollY-80;
    memoryVisible=!!memoryBox&&memoryBox.y<scrollY+H+80&&memoryBox.y+memoryBox.h>scrollY-80;
  }
  function resetSurfaces(){moving.forEach(function(item){['--mag-x','--mag-y','--card-rx','--card-ry','--lift','--surface-light'].forEach(function(key){item.el.style.removeProperty(key);});});moving.clear();surface=null;}
  function setMode(){
    var available=enabled(),mode=motionQuery.matches?'reduced':available?'running':'static';
    root.classList.toggle('fx-static',!available);root.classList.toggle('reduced-motion',motionQuery.matches);root.dataset.fxState=mode;
    if(toggle){toggle.disabled=motionQuery.matches||!ctx||!sprites.length;toggle.setAttribute('aria-pressed',String(available));toggle.title=motionQuery.matches?'遵循系统的减少动态设置':!ctx||!sprites.length?'当前环境使用静态效果':'切换背景与交互动态';var label=toggle.querySelector('[data-fx-label]');if(label)label.textContent=motionQuery.matches?'已减少':!ctx||!sprites.length?'静态':available?'开启':'关闭';}
    if(!available){resetSurfaces();pointer.on=false;memoryReveal=1;trails.forEach(function(t){t.life=0;});pulses.forEach(function(p){p.life=0;});document.querySelectorAll('.fx-reveal').forEach(function(el){el.classList.add('is-in');});}
    if(lastMode!==mode){lastMode=mode;measureNeeded=true;}
    syncClock();if(!canRun()){if(measureNeeded)measure();draw(0,false);}
  }
  function syncClock(){
    if(canRun()){if(!frameId){last=0;frameId=requestAnimationFrame(frame);}}
    else{if(frameId)cancelAnimationFrame(frameId);frameId=0;last=0;if(field)field.classList.remove('is-on');if(halo)halo.classList.remove('is-on');if(nearCtx)nearCtx.clearRect(0,0,W,H);trails.forEach(function(t){t.life=0;});}
    if(enabled())root.dataset.fxState=document.hidden||overlay?'paused':'running';
  }
  function pulse(x,y){if(!enabled()||overlay)return;var p=pulses[pulseIndex++%pulses.length];p.x=x;p.y=y;p.life=1;}
  function prepareSurfaces(){
    document.querySelectorAll('.v7-shot').forEach(function(el){if(!el.querySelector('.fx-plane')){var img=el.querySelector('img');if(img){var plane=document.createElement('span');plane.className='fx-plane';el.insertBefore(plane,img);plane.appendChild(img);}}});
    document.querySelectorAll('.btn').forEach(function(el){if(!el.querySelector('.fx-button-label')){var label=document.createElement('span');label.className='fx-button-label';while(el.firstChild)label.appendChild(el.firstChild);el.appendChild(label);}});
    document.querySelectorAll('.btn,.v7-shot,.v7-feature-tab').forEach(function(el){
      var item={el:el,box:null,card:el.classList.contains('v7-shot'),inside:false,x:0,y:0,rx:0,ry:0,lift:0,light:0};
      el.addEventListener('pointerenter',function(event){if(coarse||!enabled()||event.pointerType==='touch')return;item.box=absoluteBox(el);item.inside=true;surface=item;moving.add(item);});
      el.addEventListener('pointerleave',function(){item.inside=false;if(surface===item)surface=null;});
    });
  }
  function renderSurfaces(){
    moving.forEach(function(item){
      var b=item.box;if(!b)return;var inside=item.inside&&pointer.on&&!pointer.quiet&&enabled()&&!coarse;
      var nx=inside?Math.max(-1,Math.min(1,(pointer.x-b.x)/b.w*2-1)):0;
      var ny=inside?Math.max(-1,Math.min(1,(pointer.y-(b.y-scrollY))/b.h*2-1)):0;
      item.x+=(nx*3-item.x)*.16;item.y+=(ny*2-item.y)*.16;
      item.rx+=(-ny*3-item.rx)*.13;item.ry+=(nx*3-item.ry)*.13;item.lift+=((inside?-5:0)-item.lift)*.14;item.light+=((inside?1:0)-item.light)*.16;
      item.el.style.setProperty('--surface-x',((nx+1)*50).toFixed(2)+'%');item.el.style.setProperty('--surface-y',((ny+1)*50).toFixed(2)+'%');item.el.style.setProperty('--surface-light',item.light.toFixed(3));
      if(item.card){item.el.style.setProperty('--card-rx',item.rx.toFixed(3)+'deg');item.el.style.setProperty('--card-ry',item.ry.toFixed(3)+'deg');item.el.style.setProperty('--lift',item.lift.toFixed(3)+'px');}
      else{item.el.style.setProperty('--mag-x',item.x.toFixed(3)+'px');item.el.style.setProperty('--mag-y',item.y.toFixed(3)+'px');}
      if(!inside&&Math.abs(item.x)+Math.abs(item.y)+Math.abs(item.rx)+Math.abs(item.ry)+Math.abs(item.lift)+item.light<.035){item.el.style.setProperty('--surface-light','0');moving.delete(item);}
    });
  }
  function assess(interval,dt){
    if(elapsed<1000)return;intervalSum+=interval;intervalSamples++;slowTotal+=interval;slowFrames++;cooldown=Math.max(0,cooldown-dt);
    if(slowTotal>=2000){if(slowTotal/slowFrames>25&&quality>.46&&cooldown===0){quality=Math.max(.45,quality*.75);dropCount++;cooldown=5000;seed();}slowTotal=0;slowFrames=0;}
  }
  function frame(now){
    frameId=0;if(!canRun()){syncClock();return;}var begin=performance.now();
    var raw=last?now-last:16.67,dt=Math.min(64,Math.max(1,raw));last=now;elapsed+=dt;frameCount++;
    if(measureNeeded)measure();updateScene();
    var blend=1-Math.exp(-dt/850),flow=flows[scene];
    sceneDensity+=(palettes[scene].density-sceneDensity)*blend;flowX+=(flow[0]-flowX)*blend;flowY+=(flow[1]-flowY)*blend;
    if(memoryVisible)memoryReveal=Math.min(1,memoryReveal+dt/1400);
    var on=pointer.on&&!pointer.quiet&&!coarse;
    pointer.fx+=(pointer.x-pointer.fx)*.045;pointer.fy+=(pointer.y-pointer.fy)*.045;pointer.hx+=(pointer.x-pointer.hx)*.24;pointer.hy+=(pointer.y-pointer.hy)*.24;
    pointer.dx=pointer.hx-pointer.lastX;pointer.dy=pointer.hy-pointer.lastY;pointer.speed=Math.hypot(pointer.dx,pointer.dy);pointer.lastX=pointer.hx;pointer.lastY=pointer.hy;
    var targetX=on?(pointer.x/W-.5)*2:0,targetY=on?(pointer.y/H-.5)*2:0;pointer.nx+=(targetX-pointer.nx)*.045;pointer.ny+=(targetY-pointer.ny)*.045;
    if(field){field.classList.toggle('is-on',on);if(on)fieldInner.style.transform='translate3d('+(pointer.fx-310).toFixed(2)+'px,'+(pointer.fy-310).toFixed(2)+'px,0)';}
    if(halo){halo.classList.toggle('is-on',on);if(on)haloInner.style.transform='translate3d('+(pointer.hx-22).toFixed(2)+'px,'+(pointer.hy-22).toFixed(2)+'px,0)';}
    if(nebulaA)nebulaA.style.transform='translate3d('+(Math.sin(elapsed/19000)*24+pointer.nx*12).toFixed(2)+'px,'+(Math.cos(elapsed/24000)*20+pointer.ny*8).toFixed(2)+'px,0)';
    if(nebulaB)nebulaB.style.transform='translate3d('+(Math.cos(elapsed/26000)*30-pointer.nx*10).toFixed(2)+'px,'+(Math.sin(elapsed/17000)*18-pointer.ny*8).toFixed(2)+'px,0)';
    if(heroVisible&&art){art.style.setProperty('--portrait-x',(pointer.nx*8).toFixed(2)+'px');art.style.setProperty('--portrait-y',(pointer.ny*5).toFixed(2)+'px');art.style.setProperty('--phone-x',(pointer.nx*-4).toFixed(2)+'px');art.style.setProperty('--phone-y',(pointer.ny*-3).toFixed(2)+'px');if(sky){sky.style.setProperty('--sky-x',(pointer.nx*-12).toFixed(2)+'px');sky.style.setProperty('--sky-y',(pointer.ny*-7).toFixed(2)+'px');}}
    renderSurfaces();draw(dt,true);assess(raw,dt);
    var work=performance.now()-begin;workMs+=work;workMax=Math.max(workMax,work);workSamples++;
    frameId=requestAnimationFrame(frame);
  }
  function glow(g,x,y,size,alpha,sprite){g.globalAlpha=alpha;g.drawImage(sprites[(sprite||0)%sprites.length],x-size/2,y-size/2,size,size);}
  function draw(dt,animate){
    if(!ctx||!W||!H)return;ctx.clearRect(0,0,W,H);var seconds=dt/1000,on=animate&&pointer.on&&!pointer.quiet&&!coarse;
    var density=animate?sceneDensity:palettes[scene].density;
    function points(rows,dust){for(var i=0;i<rows.length;i++){var p=rows[i];if(p.rank>density)continue;
      if(animate){p.x+=(p.vx+flowX*(dust?3:1))*seconds;p.y+=p.vy*flowY*seconds;p.phase+=seconds*(dust ? .7 : .35);if(p.x< -12)p.x=W+12;if(p.x>W+12)p.x=-12;if(p.y< -12)p.y=H+12;if(p.y>H+12)p.y=-12;}
      var boost=0;if(on){var dx=p.x-pointer.hx,dy=p.y-pointer.hy,dist=Math.hypot(dx,dy);if(dist<230&&dist>.01){boost=1-dist/230;if(animate){var swirl=dust?.45:.2;p.x+=(dx/dist-dy/dist*swirl)*boost*.75*dt/16.67;p.y+=(dy/dist+dx/dist*swirl)*boost*.75*dt/16.67;}}}
      var alpha=p.alpha*(.9+Math.sin(p.phase)*.28)+boost*.4,size=p.r*(dust?12:6)*(1+boost*.7);
      var edgeFade=animate?Math.min(1,(density-p.rank)*24):1;
      glow(ctx,p.x,p.y,size,Math.min(.85,alpha)*edgeFade,p.sprite);
    }}
    points(stars,false);points(motes,true);
    if(memoryVisible&&memoryBox)drawMemory(animate,on);ctx.globalAlpha=1;
    if(heroVisible&&lifeCtx&&lifeW>0)drawLife(animate);
    drawForeground(dt,animate,on);
  }
  function drawForeground(dt,animate,on){
    if(!nearCtx)return;var g=nearCtx;g.clearRect(0,0,W,H);if(!animate)return;
    var seconds=dt/1000,energy=Math.min(1,pointer.speed/28);
    // A small subset of the existing stars is visible in front of the opaque hero plate.
    for(var i=0;i<stars.length;i+=6){var s=stars[i];if(s.rank>sceneDensity)continue;var proximity=on?Math.max(0,1-Math.hypot(s.x-pointer.hx,s.y-pointer.hy)/230):0;
      glow(g,s.x,s.y,10+s.r*3+proximity*10,.16+proximity*.5,s.sprite);
      if(proximity>.2||Math.sin(s.phase)>.85){var arm=1.5+proximity*3;g.globalAlpha=.3+proximity*.5;g.strokeStyle='#dbddff';g.lineWidth=.7;g.beginPath();g.moveTo(s.x-arm,s.y);g.lineTo(s.x+arm,s.y);g.moveTo(s.x,s.y-arm);g.lineTo(s.x,s.y+arm);g.stroke();}
    }
    trailWait-=dt;if(on&&pointer.speed>1.4&&trailWait<=0){
      var amount=pointer.speed>22?2:1;
      for(var n=0;n<amount;n++){var t=trails[trailIndex++%budget.trails],fraction=n/amount,spread=(Math.random()-.5)*9;
        t.x=pointer.hx-pointer.dx*fraction;t.y=pointer.hy-pointer.dy*fraction;t.px=t.x-pointer.dx/amount;t.py=t.y-pointer.dy/amount;
        t.vx=-pointer.dy/(pointer.speed||1)*spread;t.vy=pointer.dx/(pointer.speed||1)*spread-5;t.life=1;t.r=10+Math.random()*9;
      }trailWait=20;
    }
    trails.forEach(function(t){if(t.life<=0)return;t.life=Math.max(0,t.life-dt/720);var dx=t.vx*seconds,dy=t.vy*seconds;t.x+=dx;t.px+=dx;t.y+=dy;t.py+=dy;
      g.beginPath();g.moveTo(t.px,t.py);g.lineTo(t.x,t.y);g.lineCap='round';g.strokeStyle='#ae8fff';g.lineWidth=7*t.life;g.globalAlpha=t.life*.14;g.stroke();g.strokeStyle='#e3d9ff';g.lineWidth=1.25*t.life;g.globalAlpha=t.life*.76;g.stroke();glow(g,t.x,t.y,t.r*(.6+t.life),t.life*.72,1);
    });
    if(on){glow(g,pointer.hx,pointer.hy,105+energy*55,.21+energy*.16,0);glow(g,pointer.hx,pointer.hy,23+energy*7,.9,1);
      g.strokeStyle='#cbb7ff';g.lineWidth=.8;g.globalAlpha=.5;g.beginPath();g.arc(pointer.hx,pointer.hy,17+energy*5,elapsed/1200,elapsed/1200+Math.PI*1.25);g.stroke();
      var a=elapsed/950;glow(g,pointer.hx+Math.cos(a)*23,pointer.hy+Math.sin(a)*23,10,.65,2);
    }
    pulses.forEach(function(p){if(p.life<=0)return;p.life=Math.max(0,p.life-dt/720);var age=1-p.life,radius=14+age*(coarse?64:100);
      g.strokeStyle='#cab4ff';g.lineWidth=1.25;g.globalAlpha=p.life*.7;g.beginPath();g.arc(p.x,p.y,radius,0,Math.PI*2);g.stroke();g.strokeStyle='#a3d5ff';g.globalAlpha=p.life*.35;g.beginPath();g.arc(p.x,p.y,radius*.72,0,Math.PI*2);g.stroke();glow(g,p.x,p.y,90*p.life,p.life*.35,0);
      for(var j=0;j<6;j++){var angle=j*Math.PI/3+.3;glow(g,p.x+Math.cos(angle)*radius,p.y+Math.sin(angle)*radius,12*p.life,p.life*.8,j%3);}
    });
    // Clearing overlapping exclusions is stable, unlike even/odd clipping which can reopen overlaps.
    readingBoxes.forEach(function(b){var top=b.y-scrollY;if(top+b.h+b.pad<0||top-b.pad>H)return;g.clearRect(b.x-b.pad,top-b.pad,b.w+b.pad*2,b.h+b.pad*2);});g.globalAlpha=1;
  }
  function drawMemory(animate,on){
    var b=memoryBox,cx=b.x+b.w*.5,cy=b.y-scrollY+b.h*.5,rx=Math.min(b.w*.46,245),ry=b.h*.42;
    var reveal=animate?memoryReveal:1;
    ctx.lineWidth=.8;ctx.strokeStyle='#b8a2e5';
    for(var i=0;i<9;i++){var a=i/8*Math.PI*2-.4,beta=(i+1)/8*Math.PI*2-.4;
      var x=cx+Math.cos(a)*rx,y=cy+Math.sin(a)*ry;
      var shown=Math.min(1,Math.max(0,reveal*10-i));
      if(i<8&&shown>0){ctx.globalAlpha=.16*shown;ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(cx+Math.cos(a+.2)*rx*1.12,cy+Math.sin(a+.2)*ry,x+(Math.cos(beta)-Math.cos(a))*rx,y+(Math.sin(beta)-Math.sin(a))*ry);ctx.stroke();}
      var boost=on?Math.max(0,1-Math.hypot(x-pointer.x,y-pointer.y)/120):0;
      glow(ctx,x,y,12+boost*12,(.45+boost*.35)*shown,i%3);
      ctx.globalAlpha=.7*shown;ctx.fillStyle='#dbc7ff';ctx.beginPath();ctx.arc(x,y,1.2+boost,0,Math.PI*2);ctx.fill();
    }
  }
  function drawLife(animate){
    lifeCtx.clearRect(0,0,lifeW,lifeH);var phase=animate?elapsed/12000:0;
    for(var strand=0;strand<2;strand++){
      lifeCtx.beginPath();lifeCtx.strokeStyle=strand?'rgba(190,158,255,.45)':'rgba(192,221,255,.36)';lifeCtx.lineWidth=strand?.85:1.1;
      var count=Math.round(70*quality);
      for(var i=0;i<=count;i++){var t=i/count,angle=t*Math.PI*2+phase+strand*.7;
        var x=lifeW*(.38+Math.cos(angle)*.43),y=lifeH*(.79+Math.sin(angle)*.095+(t-.5)*.12);
        if(i===0)lifeCtx.moveTo(x,y);else lifeCtx.lineTo(x,y);
      }lifeCtx.stroke();
      for(var n=0;n<6;n++){var a=n/6*Math.PI*2+phase+strand*.7,x=lifeW*(.38+Math.cos(a)*.43),y=lifeH*(.79+Math.sin(a)*.095+(n/6-.5)*.12);glow(lifeCtx,x,y,12,.65,n%3);}
    }lifeCtx.globalAlpha=1;
  }
  // Events only update state. Rectangles are measured on entry/resize/content changes.
  window.addEventListener('pointermove',function(event){pointer.x=event.clientX;pointer.y=event.clientY;if(!pointer.on){pointer.hx=pointer.fx=pointer.lastX=pointer.x;pointer.hy=pointer.fy=pointer.lastY=pointer.y;}pointer.on=event.pointerType!=='touch';pointer.quiet=!!event.target.closest('p,h1,h2,h3,dt,dd,figcaption,input,textarea,video,dialog,.lightbox,a:not(.btn):not(.v7-shot),.v7-platform-head>span,.v7-before-start>strong,.v7-media-caption')||selectionActive;},{passive:true});
  var selectionActive=false;document.addEventListener('selectionchange',function(){var selection=window.getSelection();selectionActive=!!selection&&!selection.isCollapsed;if(selectionActive)pointer.quiet=true;});
  window.addEventListener('pointerdown',function(event){pointer.x=event.clientX;pointer.y=event.clientY;var selection=window.getSelection();var quiet=event.target.closest('a,button,summary,p,h1,h2,h3,dt,dd,figcaption,input,textarea,video,dialog,.lightbox');if(!quiet&&(!selection||selection.isCollapsed))pulse(pointer.x,pointer.y);},{passive:true});
  document.addEventListener('pointerleave',function(){pointer.on=false;});window.addEventListener('blur',function(){pointer.on=false;});
  window.addEventListener('scroll',function(){scrollY=window.scrollY;updateChrome();if(!canRun()){updateScene();draw(0,false);}},{passive:true});
  window.addEventListener('resize',requestMeasure,{passive:true});document.addEventListener('vg:content-change',requestMeasure);
  document.addEventListener('visibilitychange',function(){pointer.on=false;syncClock();});
  document.addEventListener('vg:overlay-change',function(event){overlay=!!event.detail;pointer.on=false;syncClock();});
  function motionChange(){setMode();}
  if(motionQuery.addEventListener)motionQuery.addEventListener('change',motionChange);else motionQuery.addListener(motionChange);
  if(pointerQuery.addEventListener)pointerQuery.addEventListener('change',requestMeasure);
  if(toggle)toggle.addEventListener('click',function(){if(motionQuery.matches)return;preference=!preference;try{localStorage.setItem('virtugene-site-motion',preference?'on':'off');}catch(_){}setMode();});
  prepareSurfaces();
  var reveals=Array.from(document.querySelectorAll('.section-head,.v7-showcase-copy,.v7-editorial-copy,.v7-gallery-heading,.v7-gallery-grid figure,.v7-download-layout'));
  reveals.forEach(function(el){el.classList.add('fx-reveal');});root.classList.add('fx-ready');
  if(window.IntersectionObserver){var revealObserver=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add('is-in');revealObserver.unobserve(entry.target);}});},{threshold:.08,rootMargin:'0px 0px 4% 0px'});reveals.forEach(function(el){revealObserver.observe(el);});}else reveals.forEach(function(el){el.classList.add('is-in');});
  if(window.ResizeObserver){var sizeObserver=new ResizeObserver(requestMeasure);sections.forEach(function(el){sizeObserver.observe(el);});}
  if(document.fonts)document.fonts.ready.then(requestMeasure);
  measure();setMode();
  // Native navigation and real media. No model/microphone runtime is present.
  var menuButton=document.getElementById('nav-menu-btn'),menu=document.getElementById('nav-menu');
  function setMenu(open){if(!menuButton||!menu)return;menu.hidden=!open;menuButton.setAttribute('aria-expanded',String(open));menuButton.setAttribute('aria-label',open?'关闭菜单':'打开菜单');}
  if(menuButton&&menu){menuButton.addEventListener('click',function(){setMenu(menu.hidden);});menu.addEventListener('click',function(e){if(e.target.closest('a'))setMenu(false);});document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!menu.hidden){setMenu(false);menuButton.focus();}});window.addEventListener('resize',function(){if(innerWidth>860)setMenu(false);});}
  var links=Array.from(document.querySelectorAll('.nav-links a'));
  if(window.IntersectionObserver){var navObserver=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(!entry.isIntersecting)return;links.forEach(function(link){link.classList.toggle('is-current',link.getAttribute('href')==='#'+entry.target.id);});});},{rootMargin:'-40% 0px -50% 0px'});sections.forEach(function(el){navObserver.observe(el);});}
  var box=document.getElementById('lightbox'),image=document.getElementById('lightbox-image'),caption=document.getElementById('lightbox-caption'),counter=document.getElementById('lightbox-count');
  var triggers=Array.from(document.querySelectorAll('[data-lightbox]')),imageIndex=0,lastFocus=null,previousOverflow='';
  function renderImage(index){imageIndex=(index+triggers.length)%triggers.length;var trigger=triggers[imageIndex],source=trigger.querySelector('img');image.src=trigger.getAttribute('data-full');image.alt=source?source.alt:'';caption.textContent=trigger.getAttribute('data-caption')||'';if(counter)counter.textContent=(imageIndex+1)+' / '+triggers.length;}
  function openImage(trigger){lastFocus=document.activeElement;previousOverflow=root.style.overflow;root.style.overflow='hidden';renderImage(triggers.indexOf(trigger));box.hidden=false;document.querySelectorAll('body > header,body > main,body > footer').forEach(function(el){el.inert=true;});overlay=true;syncClock();box.querySelector('.lightbox-close').focus();}
  function closeImage(){if(!box||box.hidden)return;box.hidden=true;root.style.overflow=previousOverflow;document.querySelectorAll('body > header,body > main,body > footer').forEach(function(el){el.inert=false;});overlay=false;syncClock();if(lastFocus&&lastFocus.isConnected)lastFocus.focus();image.removeAttribute('src');}
  if(box&&image&&caption&&triggers.length){triggers.forEach(function(trigger){trigger.addEventListener('click',function(event){if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();openImage(trigger);});});box.querySelectorAll('[data-lightbox-close]').forEach(function(el){el.addEventListener('click',closeImage);});document.getElementById('lightbox-prev').addEventListener('click',function(){renderImage(imageIndex-1);});document.getElementById('lightbox-next').addEventListener('click',function(){renderImage(imageIndex+1);});document.addEventListener('keydown',function(e){if(box.hidden)return;if(e.key==='Escape'){e.preventDefault();closeImage();}if(e.key==='ArrowLeft'){e.preventDefault();renderImage(imageIndex-1);}if(e.key==='ArrowRight'){e.preventDefault();renderImage(imageIndex+1);}});}
  var toast=document.getElementById('vg-toast'),toastTimer;
  document.querySelectorAll('[data-download]').forEach(function(a){a.addEventListener('click',function(){if(!toast)return;toast.hidden=false;toast.textContent='正在打开安装包下载。';clearTimeout(toastTimer);toastTimer=setTimeout(function(){toast.hidden=true;},3500);});});
  // Only an isolated verifier can opt into inspection; no user-facing diagnostic UI/API.
  if(window.__VG_FX_TEST__){window.__vgFxInspect=function(){return {state:root.dataset.fxState,scene:scene,clockRunning:!!frameId,frames:frameCount,coarse:coarse,quality:quality,drops:dropCount,stars:stars.length,motes:motes.length,trails:trails.filter(function(t){return t.life>0;}).length,pulses:pulses.filter(function(p){return p.life>0;}).length,budget:budget,pointer:{x:pointer.x,y:pointer.y,on:pointer.on,quiet:pointer.quiet},surfaces:moving.size,heroVisible:heroVisible,memoryVisible:memoryVisible,meanWorkMs:workSamples?workMs/workSamples:0,maxWorkMs:workMax,meanIntervalMs:intervalSamples?intervalSum/intervalSamples:0};};window.__vgFxSampleIntervals=function(samples){samples.forEach(function(value){elapsed=Math.max(elapsed,1100);assess(value,value);});};}
})();
