/* ==========================================================================
   VirtuGene 官网 · 动态视觉与交互系统（5.1.4）

   设计原则：
   - 只有一个 requestAnimationFrame 主循环（Ticker）。
   - 只有一处 pointermove 监听（PointerEngine），其它模块只读它的状态。
   - 每个模块独立初始化并各自 try/catch：任何一个出错都不影响其它模块与静态内容。
   - 内容默认可见；进入动画是"JS 先武装再播放"，脚本失效时页面照常可读。
   - 性能分三级（high / medium / low）+ prefers-reduced-motion。
   - 区域氛围：首屏最强、对话与记忆更安静、世界偏蓝紫、截图与下载克制。
   ========================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;
  var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var finePointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');

  /* ======================================================================
     0. PerformanceManager
     ====================================================================== */
  var Performance = (function () {
    var reduced = motionQuery.matches;
    var fine = finePointerQuery.matches;
    var isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    var cores = navigator.hardwareConcurrency || 4;
    var memory = navigator.deviceMemory || 4;

    var tier = 'high';
    if (isMobileUA || !fine) tier = 'medium';
    if (cores <= 2 || memory <= 2) tier = 'low';
    if (reduced) tier = 'low';

    root.classList.add('tier-' + tier);
    if (reduced) root.classList.add('reduced-motion');

    var settings = {
      high: { particles: 85, linkDist: 118, maxLinks: 52, hubRatio: 0.34, dprCap: 1.5, tilt: fine ? 5 : 0, trails: true, field: fine },
      medium: { particles: 44, linkDist: 100, maxLinks: 22, hubRatio: 0.3, dprCap: 1.25, tilt: 0, trails: true, field: fine },
      low: { particles: 0, linkDist: 0, maxLinks: 0, hubRatio: 0, dprCap: 1, tilt: 0, trails: false, field: false },
    }[tier];

    return {
      tier: tier,
      reduced: reduced,
      fine: fine,
      settings: settings,
      dpr: function () { return Math.min(window.devicePixelRatio || 1, settings.dprCap); },
    };
  })();

  /* ======================================================================
     1. Ticker
     ====================================================================== */
  var Ticker = (function () {
    var callbacks = [];
    var running = false;
    var last = 0;
    function frame(now) {
      if (!running) return;
      var dt = Math.min(48, now - last || 16);
      last = now;
      for (var i = 0; i < callbacks.length; i += 1) {
        try { callbacks[i](dt, now); } catch (error) { /* 单个订阅者出错不影响整条循环 */ }
      }
      window.requestAnimationFrame(frame);
    }
    return {
      add: function (fn) { callbacks.push(fn); },
      start: function () {
        if (running) return;
        running = true;
        last = performance.now();
        window.requestAnimationFrame(frame);
      },
      stop: function () { running = false; },
    };
  })();

  /* ======================================================================
     2. PointerEngine
     ====================================================================== */
  var PointerEngine = (function () {
    var state = {
      x: window.innerWidth * 0.5, y: window.innerHeight * 0.35,
      fx: window.innerWidth * 0.5, fy: window.innerHeight * 0.35,
      hx: window.innerWidth * 0.5, hy: window.innerHeight * 0.35,
      vx: 0, vy: 0, speed: 0, nx: 0, ny: 0, active: false,
    };
    var lastX = state.x;
    var lastY = state.y;
    function onMove(event) { state.x = event.clientX; state.y = event.clientY; state.active = true; }
    function onLeave() { state.active = false; }

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave, { passive: true });
    window.addEventListener('blur', onLeave);

    Ticker.add(function () {
      state.fx += (state.x - state.fx) * 0.055;
      state.fy += (state.y - state.fy) * 0.055;
      state.hx += (state.x - state.hx) * 0.22;
      state.hy += (state.y - state.hy) * 0.22;
      state.vx = state.hx - lastX;
      state.vy = state.hy - lastY;
      lastX = state.hx;
      lastY = state.hy;
      state.speed = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
      state.nx = (state.hx / window.innerWidth) * 2 - 1;
      state.ny = (state.hy / window.innerHeight) * 2 - 1;
    });

    return {
      state: state,
      enabled: function () { return Performance.settings.field && !Performance.reduced; },
    };
  })();

  var pointerState = PointerEngine.state;

  /* ======================================================================
     3. AtmosphereController —— 三种区域氛围
     ====================================================================== */
  var Atmosphere = (function () {
    var TARGETS = { hero: 1, quiet: 0.45, cosmos: 0.8, plain: 0.25 };
    var state = { name: 'hero', intensity: 1, target: 1 };
    return { TARGETS: TARGETS, state: state };
  })();

  function initAtmosphere() {
    var sections = Array.prototype.slice.call(document.querySelectorAll('[data-atmos]'));
    if (!sections.length) return;
    root.setAttribute('data-atmos', 'hero');
    if (!('IntersectionObserver' in window)) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var name = entry.target.getAttribute('data-atmos') || 'hero';
        var target = Atmosphere.TARGETS[name];
        Atmosphere.state.name = name;
        Atmosphere.state.target = typeof target === 'number' ? target : 1;
        root.setAttribute('data-atmos', name);
      });
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    sections.forEach(function (section) { observer.observe(section); });

    Ticker.add(function (dt) {
      Atmosphere.state.intensity += (Atmosphere.state.target - Atmosphere.state.intensity) * Math.min(1, dt / 420);
    });
  }

  /* ======================================================================
     4. 指针光场 / 光晕
     ====================================================================== */
  function initPointerVars() {
    var field = document.getElementById('vg-field');
    var halo = document.getElementById('vg-halo');
    if (!field || !halo || !PointerEngine.enabled()) return;

    var lastFx = -1, lastFy = -1, lastHx = -1, lastHy = -1;

    Ticker.add(function () {
      if (Math.abs(pointerState.fx - lastFx) > 0.1 || Math.abs(pointerState.fy - lastFy) > 0.1) {
        lastFx = pointerState.fx; lastFy = pointerState.fy;
        root.style.setProperty('--fx', lastFx.toFixed(1) + 'px');
        root.style.setProperty('--fy', lastFy.toFixed(1) + 'px');
      }
      if (Math.abs(pointerState.hx - lastHx) > 0.1 || Math.abs(pointerState.hy - lastHy) > 0.1) {
        lastHx = pointerState.hx; lastHy = pointerState.hy;
        root.style.setProperty('--hx', lastHx.toFixed(1) + 'px');
        root.style.setProperty('--hy', lastHy.toFixed(1) + 'px');
      }
      root.style.setProperty('--pointer-power', Math.min(1, pointerState.speed / 26).toFixed(3));
    });

    var sync = function () {
      var on = pointerState.active && PointerEngine.enabled() && !document.hidden;
      field.classList.toggle('is-on', on);
      halo.classList.toggle('is-on', on);
    };
    Ticker.add(sync);
    document.addEventListener('visibilitychange', sync);
  }

  /* ======================================================================
     5. ParticleEngine —— 星尘（密度随区域氛围变化）
     ====================================================================== */
  function initParticles() {
    var canvas = document.getElementById('vg-dust');
    var ctx = canvas && canvas.getContext('2d', { alpha: true });
    if (!canvas || !ctx) return;

    var cfg = Performance.settings;
    if (cfg.particles <= 0 || Performance.reduced) { canvas.style.display = 'none'; return; }

    var TINTS = ['190,178,255', '226,232,255', '150,178,255', '236,232,255'];
    var sprites = TINTS.map(function (tint) {
      var sprite = document.createElement('canvas');
      sprite.width = sprite.height = 64;
      var g = sprite.getContext('2d');
      var grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(' + tint + ',1)');
      grd.addColorStop(0.32, 'rgba(' + tint + ',0.5)');
      grd.addColorStop(1, 'rgba(' + tint + ',0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(32, 32, 32, 0, Math.PI * 2);
      g.fill();
      return sprite;
    });

    var particles = [];
    var trails = [];
    var width = 0, height = 0, dpr = 1, trailCooldown = 0;

    function seed() {
      particles.length = 0;
      var count = Math.round(cfg.particles * Math.min(1, (width * height) / (1440 * 900)));
      count = Math.max(24, Math.min(cfg.particles, count));
      for (var i = 0; i < count; i += 1) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 5,
          vy: (Math.random() - 0.5) * 5,
          r: 0.7 + Math.random() * 1.5,
          alpha: 0.16 + Math.random() * 0.34,
          sprite: (Math.random() * sprites.length) | 0,
          hub: Math.random() < cfg.hubRatio,
          rank: Math.random(),
          phase: Math.random() * Math.PI * 2,
          boost: 0,
        });
      }
    }

    function resize() {
      dpr = Performance.dpr();
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }
    window.addEventListener('resize', function () {
      window.clearTimeout(resize._t);
      resize._t = window.setTimeout(resize, 180);
    });

    var WAKE_RADIUS = 180;

    Ticker.add(function (dt) {
      if (document.hidden) return;
      var step = dt / 1000;
      var px = pointerState.hx;
      var py = pointerState.hy;
      var pointerOn = pointerState.active && PointerEngine.enabled();
      var intensity = Performance.reduced ? 0 : Atmosphere.state.intensity;
      // 氛围越安静，参与绘制的粒子越少（不只是变暗）
      var visibleRatio = 0.34 + intensity * 0.66;

      ctx.clearRect(0, 0, width, height);

      for (var i = 0; i < particles.length; i += 1) {
        var p = particles[i];
        if (p.rank > visibleRatio) continue;
        p.phase += 0.0006 * dt;
        p.x += p.vx * step;
        p.y += p.vy * step;

        if (pointerOn) {
          var dx = p.x - px;
          var dy = p.y - py;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < WAKE_RADIUS && dist > 0.001) {
            var force = (1 - dist / WAKE_RADIUS) * 0.9;
            p.x += (dx / dist) * force;
            p.y += (dy / dist) * force;
            p.boost += (1 - dist / WAKE_RADIUS - p.boost) * 0.12;
          } else {
            p.boost += (0 - p.boost) * 0.06;
          }
        } else {
          p.boost += (0 - p.boost) * 0.06;
        }

        if (p.x < -20) p.x = width + 20;
        if (p.x > width + 20) p.x = -20;
        if (p.y < -20) p.y = height + 20;
        if (p.y > height + 20) p.y = -20;
      }

      // 连线：只有枢纽粒子、且足够近
      var links = 0;
      var linkDist = cfg.linkDist;
      var linkDistSq = linkDist * linkDist;
      ctx.lineWidth = 1;
      for (var a = 0; a < particles.length && links < cfg.maxLinks; a += 1) {
        var pa = particles[a];
        if (!pa.hub || pa.rank > visibleRatio) continue;
        for (var b = a + 1; b < particles.length && links < cfg.maxLinks; b += 1) {
          var pb = particles[b];
          if (!pb.hub || pb.rank > visibleRatio) continue;
          var lx = pa.x - pb.x;
          var ly = pa.y - pb.y;
          var lsq = lx * lx + ly * ly;
          if (lsq > linkDistSq) continue;
          var t = 1 - Math.sqrt(lsq) / linkDist;
          if (t < 0.42) continue;
          var nearPointer = 0;
          if (pointerOn) {
            var mdx = (pa.x + pb.x) / 2 - px;
            var mdy = (pa.y + pb.y) / 2 - py;
            nearPointer = Math.max(0, 1 - Math.sqrt(mdx * mdx + mdy * mdy) / 260);
          }
          ctx.strokeStyle = 'rgba(168,150,255,' + ((t - 0.42) * 0.5 + nearPointer * 0.26).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
          links += 1;
        }
      }

      for (var k = 0; k < particles.length; k += 1) {
        var q = particles[k];
        if (q.rank > visibleRatio) continue;
        var twinkle = 0.82 + Math.sin(q.phase) * 0.18;
        var alpha = Math.min(1, q.alpha * twinkle + q.boost * 0.55) * (0.55 + intensity * 0.45);
        var size = q.r * 5 * (1 + q.boost * 0.5);
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprites[q.sprite], q.x - size / 2, q.y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;

      if (cfg.trails && pointerOn) {
        trailCooldown -= dt;
        if (pointerState.speed > 16 && trailCooldown <= 0 && trails.length < 34) {
          trails.push({ x: px + (Math.random() - 0.5) * 14, y: py + (Math.random() - 0.5) * 14, life: 1, r: 0.8 + Math.random() * 1.4 });
          trailCooldown = 46;
        }
      }
      for (var t2 = trails.length - 1; t2 >= 0; t2 -= 1) {
        var tr = trails[t2];
        tr.life -= dt / 420;
        if (tr.life <= 0) { trails.splice(t2, 1); continue; }
        var tsize = tr.r * 9 * tr.life;
        ctx.globalAlpha = tr.life * 0.5;
        ctx.drawImage(sprites[1], tr.x - tsize / 2, tr.y - tsize / 2, tsize, tsize);
      }
      ctx.globalAlpha = 1;
    });

    resize();
  }

  /* ======================================================================
     6. DepthSystem —— 首屏景深
     ====================================================================== */
  function initDepth() {
    if (Performance.reduced || !Performance.fine) return;
    var layers = Array.prototype.slice.call(document.querySelectorAll('[data-depth]'));
    if (!layers.length) return;
    var stage = document.querySelector('.hero-stage');
    var rim = document.querySelector('.hero-rim');

    Ticker.add(function () {
      var nx = pointerState.nx;
      var ny = pointerState.ny;
      for (var i = 0; i < layers.length; i += 1) {
        var el = layers[i];
        var depth = parseFloat(el.getAttribute('data-depth')) || 0;
        el.style.translate = (nx * depth * 34).toFixed(2) + 'px ' + (ny * depth * 24).toFixed(2) + 'px';
      }
      if (stage) {
        var tilt = Performance.settings.tilt * 1.5;
        stage.style.transform = 'rotateY(' + (nx * tilt).toFixed(2) + 'deg) rotateX(' + (-ny * tilt * 0.72).toFixed(2) + 'deg)';
      }
      if (rim) {
        rim.style.setProperty('--rim-x', (nx * -18).toFixed(1) + 'px');
        rim.style.setProperty('--rim-y', (ny * -10).toFixed(1) + 'px');
        rim.style.opacity = (0.34 + Math.min(0.28, pointerState.speed / 90)).toFixed(3);
      }
    });
  }

  /* ======================================================================
     7. TiltSystem —— 玻璃卡轻微 3D
     ====================================================================== */
  function initTilt() {
    var cards = Array.prototype.slice.call(document.querySelectorAll('[data-tilt]'));
    if (!cards.length) return;
    var maxTilt = Performance.settings.tilt;
    if (Performance.reduced || maxTilt <= 0) return;

    var items = cards.map(function (button) {
      return {
        button: button,
        device: button.querySelector('.device'),
        sheen: button.querySelector('.device-sheen'),
        rect: null, rx: 0, ry: 0, lift: 0, targetLift: 0,
      };
    });

    function measure() { items.forEach(function (item) { item.rect = item.button.getBoundingClientRect(); }); }
    function scheduleMeasure() {
      if (scheduleMeasure._t) return;
      scheduleMeasure._t = window.requestAnimationFrame(function () { scheduleMeasure._t = 0; measure(); });
    }
    window.addEventListener('scroll', scheduleMeasure, { passive: true });
    window.addEventListener('resize', scheduleMeasure);
    measure();
    window.setTimeout(measure, 1200);

    Ticker.add(function () {
      var pointerOn = pointerState.active && PointerEngine.enabled();
      var px = pointerState.hx;
      var py = pointerState.hy;
      for (var i = 0; i < items.length; i += 1) {
        var item = items[i];
        if (!item.rect || !item.device) continue;
        var rect = item.rect;
        var pad = 46;
        var inside = pointerOn && px > rect.left - pad && px < rect.right + pad && py > rect.top - pad && py < rect.bottom + pad;
        if (inside) {
          var rx = (px - rect.left) / rect.width;
          var ry = (py - rect.top) / rect.height;
          item.rx += ((rx - 0.5) * 2 * maxTilt - item.rx) * 0.12;
          item.ry += ((ry - 0.5) * 2 * maxTilt - item.ry) * 0.12;
          item.targetLift = -7;
          if (item.sheen) {
            item.sheen.style.setProperty('--sx', (rx * 100).toFixed(1) + '%');
            item.sheen.style.setProperty('--sy', (ry * 100).toFixed(1) + '%');
          }
        } else {
          item.rx += (0 - item.rx) * 0.1;
          item.ry += (0 - item.ry) * 0.1;
          item.targetLift = 0;
        }
        item.lift += (item.targetLift - item.lift) * 0.12;
        item.device.style.transform =
          'rotateY(' + item.rx.toFixed(2) + 'deg) rotateX(' + (-item.ry).toFixed(2) + 'deg) translate3d(0,' +
          item.lift.toFixed(2) + 'px,0)';
      }
    });
  }

  /* ======================================================================
     8. MagneticSystem
     ====================================================================== */
  function initMagnetic() {
    if (Performance.reduced || !Performance.fine) return;
    var targets = Array.prototype.slice.call(document.querySelectorAll('[data-magnetic], [data-spotlight]'));
    if (!targets.length) return;
    var items = targets.map(function (el) {
      return {
        el: el, rect: null, x: 0, y: 0, tx: 0, ty: 0,
        magnetic: el.hasAttribute('data-magnetic'),
        spotlight: el.hasAttribute('data-spotlight'),
      };
    });
    function measure() { items.forEach(function (item) { item.rect = item.el.getBoundingClientRect(); }); }
    var scheduleMeasure = function () {
      if (scheduleMeasure._t) return;
      scheduleMeasure._t = window.requestAnimationFrame(function () { scheduleMeasure._t = 0; measure(); });
    };
    window.addEventListener('scroll', scheduleMeasure, { passive: true });
    window.addEventListener('resize', scheduleMeasure);
    measure();

    Ticker.add(function () {
      var pointerOn = pointerState.active;
      var px = pointerState.hx;
      var py = pointerState.hy;
      for (var i = 0; i < items.length; i += 1) {
        var item = items[i];
        if (!item.rect) continue;
        var rect = item.rect;
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var dx = px - cx;
        var dy = py - cy;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var reach = Math.max(rect.width, rect.height) * 0.9 + 60;
        if (pointerOn && dist < reach) {
          var pull = 1 - dist / reach;
          if (item.magnetic) { item.tx = dx * pull * 0.09; item.ty = dy * pull * 0.09; }
          if (item.spotlight) {
            item.el.style.setProperty('--sx', (((px - rect.left) / rect.width) * 100).toFixed(1) + '%');
            item.el.style.setProperty('--sy', (((py - rect.top) / rect.height) * 100).toFixed(1) + '%');
          }
        } else if (item.magnetic) {
          item.tx = 0; item.ty = 0;
        }
        if (item.magnetic) {
          item.x += (item.tx - item.x) * 0.16;
          item.y += (item.ty - item.y) * 0.16;
          item.el.style.translate = item.x.toFixed(2) + 'px ' + item.y.toFixed(2) + 'px';
        }
      }
    });
  }

  /* ======================================================================
     9. ScrollSystem
     ====================================================================== */
  function initScroll() {
    var nav = document.getElementById('nav');
    var progress = document.getElementById('vg-progress');

    var ticking = false;
    function updateChrome() {
      ticking = false;
      var max = Math.max(1, document.body.scrollHeight - window.innerHeight);
      var ratio = Math.min(1, Math.max(0, window.scrollY / max));
      if (progress) progress.style.transform = 'scaleX(' + ratio.toFixed(4) + ')';
      if (nav) nav.classList.toggle('is-scrolled', window.scrollY > 8);
    }
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateChrome);
    }, { passive: true });
    updateChrome();

    var REVEAL_SELECTOR = [
      '.section-head',
      '.meet-points',
      '.principle',
      '.meet-shot',
      '.memory-demo',
      '.memory-pager',
      '.pager-dots',
      '.demo-note',
      '.tabs',
      '.panels',
      '.stage-note',
      '.gallery-grid',
      '.gallery-rail',
      '.rail-hint',
      '.platforms',
      '.download-notes'
    ].join(', ');

    if (!Performance.reduced && 'IntersectionObserver' in window) {
      var nodes = Array.prototype.slice.call(document.querySelectorAll(REVEAL_SELECTOR));
      var armed = [];
      nodes.forEach(function (node) {
        if (node.getBoundingClientRect().top > window.innerHeight * 0.92) {
          node.classList.add('is-armed');
          armed.push(node);
        }
      });
      var reveal = function (node) { if (!node.classList.contains('is-in')) node.classList.add('is-in'); };
      var observer = new IntersectionObserver(function (entries, self) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          reveal(entry.target);
          self.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
      armed.forEach(function (node) { observer.observe(node); });

      window.addEventListener('scroll', function () {
        for (var i = 0; i < armed.length; i += 1) {
          var node = armed[i];
          if (node.classList.contains('is-in')) continue;
          if (node.getBoundingClientRect().top < window.innerHeight * 0.94) reveal(node);
        }
      }, { passive: true });
    }

    if ('IntersectionObserver' in window) {
      var links = Array.prototype.slice.call(document.querySelectorAll('.nav-links a'));
      var map = {};
      links.forEach(function (link) {
        var id = (link.getAttribute('href') || '').replace('#', '');
        var section = id && document.getElementById(id);
        if (section) map[id] = link;
      });
      var sectionObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var link = map[entry.target.id];
          if (!link || !entry.isIntersecting) return;
          links.forEach(function (l) { l.classList.remove('is-current'); });
          link.classList.add('is-current');
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      Object.keys(map).forEach(function (id) { sectionObserver.observe(document.getElementById(id)); });
    }
  }

  /* ======================================================================
     10. 世界切换
     ====================================================================== */
  function initTabs() {
    var list = document.querySelector('.tabs');
    var stage = document.getElementById('world-stage');
    if (!list) return;
    var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
    if (!tabs.length) return;
    var panels = tabs.map(function (tab) { return document.getElementById(tab.getAttribute('aria-controls') || ''); });

    function select(index, moveFocus) {
      var keys = ['map', 'scene', 'timeline'];
      tabs.forEach(function (tab, i) {
        var active = i === index;
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        tab.tabIndex = active ? 0 : -1;
        var panel = panels[i];
        if (!panel) return;
        if (active) {
          panel.hidden = false;
          panel.classList.add('is-entering');
          void panel.offsetHeight;
          window.requestAnimationFrame(function () { panel.classList.remove('is-entering'); });
        } else {
          panel.hidden = true;
          panel.classList.remove('is-entering');
        }
      });
      if (stage) stage.setAttribute('data-world', keys[index] || 'map');
      if (moveFocus) tabs[index].focus();
    }

    tabs.forEach(function (tab, i) { tab.addEventListener('click', function () { select(i, false); }); });
    list.addEventListener('keydown', function (event) {
      var current = tabs.indexOf(document.activeElement);
      if (current < 0) return;
      var next = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % tabs.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      if (next === null) return;
      event.preventDefault();
      select(next, true);
    });

    var initial = tabs.findIndex(function (tab) { return tab.getAttribute('aria-selected') === 'true'; });
    select(initial < 0 ? 0 : initial, false);

    var warmUp = function () {
      panels.forEach(function (panel) {
        if (!panel) return;
        var img = panel.querySelector('img[data-warm]');
        if (!img) return;
        var src = img.getAttribute('data-warm');
        img.removeAttribute('data-warm');
        var preload = new Image();
        preload.decoding = 'async';
        preload.src = src;
      });
    };
    if (stage && 'IntersectionObserver' in window) {
      var warmer = new IntersectionObserver(function (entries, self) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          warmUp();
          self.disconnect();
        });
      }, { rootMargin: '320px 0px' });
      warmer.observe(stage);
    } else {
      warmUp();
    }
  }

  /* ======================================================================
     11. 世界星图：点节点看详情
     ====================================================================== */
  var MAP_NODES = {
    core: { title: '我的生活', place: '正在持续', cast: '古月娜 · 艾莉 · 林霜', time: '此刻', beat: '时间会走，角色也有自己的去处。' },
    rain: { title: '雨夜便利店', place: '街角便利店', cast: '古月娜 · 艾莉', time: '深夜', beat: '你把面试的事说给她听。' },
    roof: { title: '天台夜谈', place: '学校天台', cast: '艾莉', time: '傍晚', beat: '风把云的影子推着走。' },
    ice: { title: '冰原重逢', place: '极北冰原', cast: '古月娜', time: '清晨', beat: '她还没承认自己等了很久。（已暂停）' },
  };

  function initStarMap() {
    var map = document.getElementById('star-map');
    var detail = document.getElementById('map-detail');
    if (!map || !detail) return;
    var nodes = Array.prototype.slice.call(map.querySelectorAll('.map-node'));
    if (!nodes.length) return;

    function select(node) {
      nodes.forEach(function (n) { n.setAttribute('aria-pressed', n === node ? 'true' : 'false'); });
      var data = MAP_NODES[node.getAttribute('data-node')] || MAP_NODES.core;
      ['title', 'place', 'cast', 'time', 'beat'].forEach(function (key) {
        var el = detail.querySelector('[data-detail="' + key + '"]');
        if (el && data[key]) el.textContent = data[key];
      });
    }

    nodes.forEach(function (node) {
      node.addEventListener('click', function () { select(node); });
    });

    var pressed = nodes.filter(function (n) { return n.getAttribute('aria-pressed') === 'true'; })[0];
    select(pressed || nodes[0]);
  }

  /* ======================================================================
     12. 记忆三步演示（桌面联动 + 手机分页）
     ====================================================================== */
  function initMemoryDemo() {
    var steps = Array.prototype.slice.call(document.querySelectorAll('.step'));
    var demos = document.querySelectorAll('[data-memory-demo]').length > 0;
    var stepsList = document.querySelector('[data-steps]');
    var pager = document.querySelector('[data-memory-pager]');
    var dots = Array.prototype.slice.call(document.querySelectorAll('.pager-dot'));
    var screens = steps.map(function (step) { return document.getElementById(step.getAttribute('aria-controls') || ''); });
    var current = 0;

    function syncDots(index) {
      dots.forEach(function (dot, i) {
        dot.classList.toggle('is-active', i === index);
        dot.setAttribute('aria-selected', i === index ? 'true' : 'false');
      });
    }

    function select(index, moveFocus) {
      if (index < 0 || index >= Math.max(steps.length, 3)) return;
      current = index;
      if (demos && steps.length) {
        steps.forEach(function (step, i) {
          var active = i === index;
          step.setAttribute('aria-selected', active ? 'true' : 'false');
          step.tabIndex = active ? 0 : -1;
          var screen = screens[i];
          if (!screen) return;
          if (active) {
            screen.hidden = false;
            screen.classList.add('is-entering');
            void screen.offsetHeight;
            window.requestAnimationFrame(function () { screen.classList.remove('is-entering'); });
          } else {
            screen.hidden = true;
            screen.classList.remove('is-entering');
          }
        });
      }
      if (stepsList) stepsList.style.setProperty('--lit', index === 0 ? 0.34 : index === 1 ? 0.68 : 1);
      syncDots(index);
      if (moveFocus && steps[index]) steps[index].focus();
    }

    if (demos && steps.length) {
      steps.forEach(function (step, i) { step.addEventListener('click', function () { select(i, false); }); });
      var list = stepsList;
      if (list) {
        list.addEventListener('keydown', function (event) {
          var at = steps.indexOf(document.activeElement);
          if (at < 0) return;
          var next = null;
          if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (at + 1) % steps.length;
          else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (at - 1 + steps.length) % steps.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = steps.length - 1;
          if (next === null) return;
          event.preventDefault();
          select(next, true);
        });
      }
    }

    // 手机分页：滑动或点圆点
    function scrollToSlide(index) {
      if (!pager || !pager.children[index]) return;
      var slide = pager.children[index];
      pager.scrollTo({ left: slide.offsetLeft - pager.offsetLeft, behavior: Performance.reduced ? 'auto' : 'smooth' });
    }

    dots.forEach(function (dot, i) {
      dot.addEventListener('click', function () {
        select(i, false);
        scrollToSlide(i);
      });
    });

    if (pager) {
      var ticking = false;
      pager.addEventListener('scroll', function () {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(function () {
          ticking = false;
          var center = pager.scrollLeft + pager.clientWidth / 2;
          var best = 0;
          var bestDist = Infinity;
          Array.prototype.forEach.call(pager.children, function (slide, i) {
            var c = slide.offsetLeft + slide.offsetWidth / 2;
            var d = Math.abs(c - center);
            if (d < bestDist) { bestDist = d; best = i; }
          });
          if (best !== current) syncDots(best), (current = best);
        });
      }, { passive: true });
    }

    select(0, false);
  }

  /* ======================================================================
     13. 手机端导航菜单
     ====================================================================== */
  function initNavMenu() {
    var button = document.getElementById('nav-menu-btn');
    var menu = document.getElementById('nav-menu');
    if (!button || !menu) return;
    function setOpen(open) {
      menu.hidden = !open;
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      button.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    }
    button.addEventListener('click', function () { setOpen(menu.hidden); });
    menu.addEventListener('click', function (event) {
      if (event.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !menu.hidden) { setOpen(false); button.focus(); }
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 860 && !menu.hidden) setOpen(false);
    });
  }

  /* ======================================================================
     14. 下载提示
     ====================================================================== */
  function initDownloadToast() {
    var toast = document.getElementById('vg-toast');
    var links = Array.prototype.slice.call(document.querySelectorAll('[data-download]'));
    if (!toast || !links.length) return;
    var hideTimer = 0;
    var offTimer = 0;
    links.forEach(function (link) {
      link.addEventListener('click', function () {
        toast.textContent = '正在下载安装包';
        toast.hidden = false;
        void toast.offsetHeight;
        toast.classList.add('is-on');
        window.clearTimeout(hideTimer);
        window.clearTimeout(offTimer);
        hideTimer = window.setTimeout(function () {
          toast.classList.remove('is-on');
          offTimer = window.setTimeout(function () { toast.hidden = true; }, 260);
        }, 2400);
      });
    });
  }

  /* ======================================================================
     15. 图片查看（左右切换 / 下滑关闭）
     ====================================================================== */
  function initLightbox() {
    var box = document.getElementById('lightbox');
    var image = document.getElementById('lightbox-image');
    var caption = document.getElementById('lightbox-caption');
    var counter = document.getElementById('lightbox-count');
    var closeButton = box ? box.querySelector('.lightbox-close') : null;
    var prevButton = document.getElementById('lightbox-prev');
    var nextButton = document.getElementById('lightbox-next');
    var figure = box ? box.querySelector('.lightbox-figure') : null;
    var triggers = Array.prototype.slice.call(document.querySelectorAll('[data-lightbox]'));
    if (!box || !image || !caption || !closeButton || !triggers.length) return;

    var CLOSE_MS = 340;
    var index = 0;
    var lastFocus = null;
    var previousOverflow = '';
    var token = 0;
    var hideTimer = 0;

    function render(i) {
      index = (i + triggers.length) % triggers.length;
      var trigger = triggers[index];
      image.setAttribute('src', trigger.getAttribute('data-full'));
      var inner = trigger.querySelector('img');
      image.setAttribute('alt', inner ? inner.getAttribute('alt') || '' : '');
      caption.textContent = trigger.getAttribute('data-caption') || '';
      if (counter) counter.textContent = (index + 1) + ' / ' + triggers.length;
    }

    function open(trigger) {
      var at = triggers.indexOf(trigger);
      token += 1;
      window.clearTimeout(hideTimer);
      lastFocus = document.activeElement;
      previousOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      render(at < 0 ? 0 : at);
      box.hidden = false;
      void box.offsetHeight;
      window.requestAnimationFrame(function () { box.classList.add('is-open'); });
      closeButton.focus();
    }

    function close() {
      var myToken = ++token;
      box.classList.remove('is-open');
      document.documentElement.style.overflow = previousOverflow;
      if (figure) figure.style.transform = '';
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
      hideTimer = window.setTimeout(function () {
        if (myToken !== token) return;
        box.hidden = true;
        image.removeAttribute('src');
        caption.textContent = '';
      }, CLOSE_MS);
    }

    function step(delta) { render(index + delta); }

    triggers.forEach(function (trigger) { trigger.addEventListener('click', function () { open(trigger); }); });
    Array.prototype.forEach.call(box.querySelectorAll('[data-lightbox-close]'), function (node) { node.addEventListener('click', close); });
    if (prevButton) prevButton.addEventListener('click', function () { step(-1); });
    if (nextButton) nextButton.addEventListener('click', function () { step(1); });

    document.addEventListener('keydown', function (event) {
      if (box.hidden) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); return; }
      if (event.key === 'ArrowRight') { event.preventDefault(); step(1); return; }
      if (event.key === 'Tab') { event.preventDefault(); closeButton.focus(); }
    });

    Array.prototype.forEach.call(document.querySelectorAll('a[href^="#"]'), function (link) {
      link.addEventListener('click', function () { if (!box.hidden) close(); });
    });

    // 触摸：左右切换 / 下滑关闭
    if (figure) {
      var startX = 0;
      var startY = 0;
      var dx = 0;
      var dy = 0;
      var dragging = false;

      figure.addEventListener('touchstart', function (event) {
        if (event.touches.length !== 1) return;
        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
        dx = 0; dy = 0; dragging = true;
        figure.style.transition = 'none';
      }, { passive: true });

      figure.addEventListener('touchmove', function (event) {
        if (!dragging || event.touches.length !== 1) return;
        dx = event.touches[0].clientX - startX;
        dy = event.touches[0].clientY - startY;
        if (Math.abs(dy) > Math.abs(dx)) {
          figure.style.transform = 'translate3d(0,' + Math.max(0, dy) + 'px,0)';
          figure.style.opacity = String(Math.max(0.35, 1 - Math.abs(dy) / 320));
        } else {
          figure.style.transform = 'translate3d(' + dx + 'px,0,0)';
        }
      }, { passive: true });

      figure.addEventListener('touchend', function () {
        if (!dragging) return;
        dragging = false;
        figure.style.transition = '';
        figure.style.transform = '';
        figure.style.opacity = '';
        if (dy > 90 && Math.abs(dy) > Math.abs(dx)) { close(); return; }
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
      }, { passive: true });
    }
  }

  /* ======================================================================
     16. ScrollerWarmup —— 横向滑动容器里的懒加载图，进入视口前先预热
     （浏览器不会为横向滚动区外的图片发起请求，不预热的话滑动时会出现空白帧）
     ====================================================================== */
  function initScrollerWarmup() {
    var scrollers = Array.prototype.slice.call(
      document.querySelectorAll('[data-memory-pager], [data-gallery-rail], .gallery-grid'),
    );
    if (!scrollers.length || !('IntersectionObserver' in window)) return;

    var warm = function (scroller) {
      Array.prototype.forEach.call(scroller.querySelectorAll('img[loading="lazy"]'), function (img) {
        var src = img.getAttribute('src');
        if (!src) return;
        img.setAttribute('loading', 'eager');
        var preload = new Image();
        preload.decoding = 'async';
        preload.src = src;
      });
    };

    var observer = new IntersectionObserver(function (entries, self) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        warm(entry.target);
        self.unobserve(entry.target);
      });
    }, { rootMargin: '400px 0px' });
    scrollers.forEach(function (scroller) { observer.observe(scroller); });
  }

  /* ======================================================================
     17. AmbientSync
     ====================================================================== */
  function initAmbient() {
    var backlight = document.getElementById('vg-hero-backlight');
    var heroVisual = document.querySelector('.hero-visual');

    var sync = function () {
      if (!backlight || !heroVisual) return;
      var rect = heroVisual.getBoundingClientRect();
      if (rect.width <= 0) return;
      backlight.style.left = rect.left + rect.width * 0.5 + 'px';
      backlight.style.top = rect.top + rect.height * 0.42 + 'px';
      backlight.style.width = rect.width * 2.6 + 'px';
      backlight.style.height = rect.width * 2.6 + 'px';
      backlight.style.marginLeft = -rect.width * 1.3 + 'px';
    };

    var scheduled = false;
    var schedule = function () {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(function () { scheduled = false; sync(); });
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.setTimeout(sync, 60);
    sync();

    var setPaused = function (paused) { root.classList.toggle('is-paused', paused); };
    document.addEventListener('visibilitychange', function () { setPaused(document.hidden); });
    setPaused(document.hidden);
  }

  /* ======================================================================
     启动
     ====================================================================== */
  var modules = [
    initAtmosphere,
    initPointerVars,
    initParticles,
    initDepth,
    initTilt,
    initMagnetic,
    initScroll,
    initTabs,
    initStarMap,
    initMemoryDemo,
    initNavMenu,
    initDownloadToast,
    initLightbox,
    initScrollerWarmup,
    initAmbient,
  ];

  modules.forEach(function (init) {
    try { init(); } catch (error) {
      if (window.console && window.console.warn) window.console.warn('[virtugene] init failed:', error);
    }
  });

  Ticker.start();
  if (Performance.reduced) Ticker.stop();

  var onMotionChange = function () {
    var reduced = motionQuery.matches;
    root.classList.toggle('reduced-motion', reduced);
    if (reduced) Ticker.stop(); else Ticker.start();
  };
  if (motionQuery.addEventListener) motionQuery.addEventListener('change', onMotionChange);
  else if (motionQuery.addListener) motionQuery.addListener(onMotionChange);
})();
