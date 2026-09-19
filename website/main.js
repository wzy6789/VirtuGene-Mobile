/* ==========================================================================
   VirtuGene 官网 · 动态视觉系统
   --------------------------------------------------------------------------
   设计原则：
   - 只有一个 requestAnimationFrame 主循环（Ticker），所有逐帧效果挂在它上面。
   - 只有一处 pointermove 监听（PointerEngine），其他模块只读它的状态。
   - 每个模块独立初始化并各自 try/catch：任何一个出错都不影响其它模块与静态内容。
   - 内容默认可见；进入动画是"JS 先武装再播放"，脚本失效时页面照常可读。
   - 性能分三级（high / medium / low）+ prefers-reduced-motion，低配只保留基本光影。
   ========================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;
  var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var finePointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');

  /* ======================================================================
     0. PerformanceManager —— 先决定能力等级，后面所有模块都据此降级
     ====================================================================== */
  var Performance = (function () {
    var reduced = motionQuery.matches;
    var fine = finePointerQuery.matches;
    var isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    var cores = navigator.hardwareConcurrency || 4;
    var memory = navigator.deviceMemory || 4;

    var tier = 'high';
    // 触屏 / 手机：弱化粒子与 disable tilt，但保留基础沉浸感
    if (isMobileUA || !fine) tier = 'medium';
    if (isMobileUA && cores <= 4) tier = 'medium';
    // 真正的低配（老设备 / 双核 / 内存很小）才降到 low
    if (cores <= 2 || memory <= 2) tier = 'low';
    if (reduced) tier = 'low';

    root.classList.add('tier-' + tier);
    if (reduced) root.classList.add('reduced-motion');

    var settings = {
      high: { particles: 85, linkDist: 118, maxLinks: 52, hubRatio: 0.34, dprCap: 1.5, tilt: fine ? 5 : 0, trails: true, field: fine },
      medium: { particles: 52, linkDist: 100, maxLinks: 26, hubRatio: 0.3, dprCap: 1.25, tilt: fine ? 3.4 : 0, trails: true, field: fine },
      low: { particles: 0, linkDist: 0, maxLinks: 0, hubRatio: 0, dprCap: 1, tilt: 0, trails: false, field: false },
    }[tier];

    return {
      tier: tier,
      reduced: reduced,
      fine: fine,
      settings: settings,
      dpr: function () {
        return Math.min(window.devicePixelRatio || 1, settings.dprCap);
      },
    };
  })();

  /* ======================================================================
     1. Ticker —— 唯一的主循环
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
        try {
          callbacks[i](dt, now);
        } catch (error) {
          /* 单个订阅者出错不影响整条循环 */
        }
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
     2. PointerEngine —— 全站唯一的指针状态源
     输出：x / y（原始）、fx / fy（大范围光场，慢跟随）、hx / hy（核心，快跟随）、
           speed（px/帧）、nx / ny（归一化 -1..1）、active
     ====================================================================== */
  var PointerEngine = (function () {
    var state = {
      x: window.innerWidth * 0.5,
      y: window.innerHeight * 0.35,
      fx: window.innerWidth * 0.5,
      fy: window.innerHeight * 0.35,
      hx: window.innerWidth * 0.5,
      hy: window.innerHeight * 0.35,
      vx: 0,
      vy: 0,
      speed: 0,
      nx: 0,
      ny: 0,
      active: false,
    };

    var lastX = state.x;
    var lastY = state.y;

    function onMove(event) {
      state.x = event.clientX;
      state.y = event.clientY;
      state.active = true;
    }
    function onLeave() { state.active = false; }

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave, { passive: true });
    window.addEventListener('blur', onLeave);

    // 大范围光场慢跟随（有惯性），核心光晕快跟随
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
      /** 是否允许跟随类效果（降级 / 触屏时为 false） */
      enabled: function () { return Performance.settings.field && !Performance.reduced; },
    };
  })();

  var pointerState = PointerEngine.state;

  /* 把指针位置写进 CSS 变量，供光场 / 光晕使用 */
  function initPointerVars() {
    var field = document.getElementById('vg-field');
    var halo = document.getElementById('vg-halo');
    if (!field || !halo) return;
    if (!PointerEngine.enabled()) return;

    var lastFx = -1;
    var lastFy = -1;
    var lastHx = -1;
    var lastHy = -1;

    Ticker.add(function () {
      if (Math.abs(pointerState.fx - lastFx) > 0.1 || Math.abs(pointerState.fy - lastFy) > 0.1) {
        lastFx = pointerState.fx;
        lastFy = pointerState.fy;
        root.style.setProperty('--fx', lastFx.toFixed(1) + 'px');
        root.style.setProperty('--fy', lastFy.toFixed(1) + 'px');
      }
      if (Math.abs(pointerState.hx - lastHx) > 0.1 || Math.abs(pointerState.hy - lastHy) > 0.1) {
        lastHx = pointerState.hx;
        lastHy = pointerState.hy;
        root.style.setProperty('--hx', lastHx.toFixed(1) + 'px');
        root.style.setProperty('--hy', lastHy.toFixed(1) + 'px');
      }
      var power = Math.min(1, pointerState.speed / 26);
      root.style.setProperty('--pointer-power', power.toFixed(3));
    });

    // 指针离开窗口或设备不支持悬停时，光场淡出
    var sync = function () {
      var on = pointerState.active && PointerEngine.enabled() && !document.hidden;
      field.classList.toggle('is-on', on);
      halo.classList.toggle('is-on', on);
    };
    Ticker.add(sync);
    document.addEventListener('visibilitychange', sync);
  }

  /* ======================================================================
     3. ParticleEngine —— 星尘粒子（VS Code 背景粒子的思路，但更安静克制）
     规则：低密度慢速漂浮；只有"枢纽粒子"之间、且距离足够近时才连线；
           指针靠近才被唤醒（微弱排斥 + 亮度提升 + 少量短线 + 快速移动时短拖尾）
     ====================================================================== */
  function initParticles() {
    var canvas = document.getElementById('vg-dust');
    var ctx = canvas && canvas.getContext('2d', { alpha: true });
    if (!canvas || !ctx) return;

    var cfg = Performance.settings;
    if (cfg.particles <= 0 || Performance.reduced) {
      canvas.style.display = 'none';
      return;
    }

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
    var width = 0;
    var height = 0;
    var dpr = 1;
    var trailCooldown = 0;

    function seed() {
      particles.length = 0;
      var count = Math.round(cfg.particles * Math.min(1, (width * height) / (1440 * 900)));
      count = Math.max(28, Math.min(cfg.particles, count));
      for (var i = 0; i < count; i += 1) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          // 数字尘埃：每秒几像素，几乎察觉不到在动
          vx: (Math.random() - 0.5) * 5,
          vy: (Math.random() - 0.5) * 5,
          r: 0.7 + Math.random() * 1.5,
          alpha: 0.16 + Math.random() * 0.34,
          sprite: (Math.random() * sprites.length) | 0,
          hub: Math.random() < cfg.hubRatio,
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

      ctx.clearRect(0, 0, width, height);

      // --- 更新 -------------------------------------------------------
      for (var i = 0; i < particles.length; i += 1) {
        var p = particles[i];
        p.phase += 0.0006 * dt;
        p.x += p.vx * step;
        p.y += p.vy * step;

        if (pointerOn) {
          var dx = p.x - px;
          var dy = p.y - py;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < WAKE_RADIUS && dist > 0.001) {
            // 微弱排斥：越近越明显，但绝不把粒子推开视野
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

        // 环绕，避免边缘堆积
        if (p.x < -20) p.x = width + 20;
        if (p.x > width + 20) p.x = -20;
        if (p.y < -20) p.y = height + 20;
        if (p.y > height + 20) p.y = -20;
      }

      // --- 连线：只有枢纽粒子、且足够近 -------------------------------
      var links = 0;
      var linkDist = cfg.linkDist;
      var linkDistSq = linkDist * linkDist;
      ctx.lineWidth = 1;
      for (var a = 0; a < particles.length && links < cfg.maxLinks; a += 1) {
        var pa = particles[a];
        if (!pa.hub) continue;
        for (var b = a + 1; b < particles.length && links < cfg.maxLinks; b += 1) {
          var pb = particles[b];
          if (!pb.hub) continue;
          var lx = pa.x - pb.x;
          var ly = pa.y - pb.y;
          var lsq = lx * lx + ly * ly;
          if (lsq > linkDistSq) continue;
          var t = 1 - Math.sqrt(lsq) / linkDist;
          if (t < 0.42) continue; // 只保留足够近的那一小部分，线条天然稀疏
          var nearPointer = 0;
          if (pointerOn) {
            var mdx = (pa.x + pb.x) / 2 - px;
            var mdy = (pa.y + pb.y) / 2 - py;
            var mdist = Math.sqrt(mdx * mdx + mdy * mdy);
            nearPointer = Math.max(0, 1 - mdist / 260);
          }
          ctx.strokeStyle = 'rgba(168,150,255,' + ((t - 0.42) * 0.5 + nearPointer * 0.26).toFixed(3) + ')';
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
          links += 1;
        }
      }

      // --- 绘制粒子 ---------------------------------------------------
      for (var k = 0; k < particles.length; k += 1) {
        var q = particles[k];
        var twinkle = 0.82 + Math.sin(q.phase) * 0.18;
        var alpha = Math.min(1, q.alpha * twinkle + q.boost * 0.55);
        var size = q.r * 5 * (1 + q.boost * 0.5);
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprites[q.sprite], q.x - size / 2, q.y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;

      // --- 拖尾：只在快速移动时产生少量短线 ---------------------------
      if (cfg.trails && pointerOn) {
        trailCooldown -= dt;
        if (pointerState.speed > 16 && trailCooldown <= 0 && trails.length < 34) {
          trails.push({
            x: px + (Math.random() - 0.5) * 14,
            y: py + (Math.random() - 0.5) * 14,
            life: 1,
            r: 0.8 + Math.random() * 1.4,
          });
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
     4. DepthSystem —— 首屏景深：人物最大、光晕次之、文字最小
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
        // 用独立的 translate 属性，避免和入场动画的 transform 抢同一个属性
        el.style.translate = (nx * depth * 34).toFixed(2) + 'px ' + (ny * depth * 24).toFixed(2) + 'px';
      }

      if (stage) {
        var tilt = Performance.settings.tilt * 1.5;
        stage.style.transform =
          'rotateY(' + (nx * tilt).toFixed(2) + 'deg) rotateX(' + (-ny * tilt * 0.72).toFixed(2) + 'deg)';
      }
      if (rim) {
        // 边缘高光随指针方向轻微移动
        rim.style.setProperty('--rim-x', (nx * -18).toFixed(1) + 'px');
        rim.style.setProperty('--rim-y', (ny * -10).toFixed(1) + 'px');
        rim.style.opacity = (0.34 + Math.min(0.28, pointerState.speed / 90)).toFixed(3);
      }
    });
  }

  /* ======================================================================
     5. TiltSystem —— 产品截图的 3D 倾斜 + 反光
     一次性缓存 rect，避免逐帧 layout 抖动
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
        rect: null,
        rx: 0,
        ry: 0,
        lift: 0,
        targetLift: 0,
        active: false,
      };
    });

    function measure() {
      items.forEach(function (item) {
        item.rect = item.button.getBoundingClientRect();
      });
    }

    function scheduleMeasure() {
      if (scheduleMeasure._t) return;
      scheduleMeasure._t = window.requestAnimationFrame(function () {
        scheduleMeasure._t = 0;
        measure();
      });
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
        var inside = pointerOn &&
          px > rect.left - pad && px < rect.right + pad &&
          py > rect.top - pad && py < rect.bottom + pad;

        if (inside) {
          var rx = (px - rect.left) / rect.width;   // 0..1
          var ry = (py - rect.top) / rect.height;   // 0..1
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

        // 幅度很小：只做"被唤醒"的感觉，不做夸张翻转
        item.device.style.transform =
          'rotateY(' + item.rx.toFixed(2) + 'deg) rotateX(' + (-item.ry).toFixed(2) + 'deg) translate3d(0,' +
          item.lift.toFixed(2) + 'px,0)';
      }
    });
  }

  /* ======================================================================
     6. MagneticSystem —— 按钮磁吸 + 局部光斑
     ====================================================================== */
  function initMagnetic() {
    if (Performance.reduced || !Performance.fine) return;

    var targets = Array.prototype.slice.call(document.querySelectorAll('[data-magnetic], [data-spotlight]'));
    if (!targets.length) return;

    var items = targets.map(function (el) {
      return { el: el, rect: null, x: 0, y: 0, tx: 0, ty: 0, magnetic: el.hasAttribute('data-magnetic'), spotlight: el.hasAttribute('data-spotlight') };
    });

    function measure() {
      items.forEach(function (item) { item.rect = item.el.getBoundingClientRect(); });
    }
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
          if (item.magnetic) {
            item.tx = dx * pull * 0.09;
            item.ty = dy * pull * 0.09;
          }
          if (item.spotlight) {
            var sx = ((px - rect.left) / rect.width) * 100;
            var sy = ((py - rect.top) / rect.height) * 100;
            item.el.style.setProperty('--sx', sx.toFixed(1) + '%');
            item.el.style.setProperty('--sy', sy.toFixed(1) + '%');
          }
        } else if (item.magnetic) {
          item.tx = 0;
          item.ty = 0;
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
     7. ScrollSystem —— 进度线 / 导航 / 进入动画 / 记忆连接线
     ====================================================================== */
  function initScroll() {
    var nav = document.getElementById('nav');
    var progress = document.getElementById('vg-progress');
    var steps = document.querySelector('[data-steps]');

    /* 7.1 进度线与导航状态 */
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

    /* 7.2 进入动画：先武装再播放；没有 JS 时根本不武装 */
    var REVEAL_SELECTOR = [
      '.section-head',
      '.manifesto-lede',
      '.manifesto-grid',
      '.meet-points',
      '.meet-shot',
      '.steps',
      '.demo-note',
      '.memory-aside .shot',
      '.tabs',
      '.panels',
      '.stage-note',
      '.gallery-grid',
      '.platforms',
      '.download-notes'
    ].join(', ');

    if (!Performance.reduced && 'IntersectionObserver' in window) {
      var nodes = Array.prototype.slice.call(document.querySelectorAll(REVEAL_SELECTOR));
      var armed = [];

      nodes.forEach(function (node) {
        // 只武装"明显在首屏之外"的元素：首屏内容不参与，避免任何闪一下
        if (node.getBoundingClientRect().top > window.innerHeight * 0.92) {
          node.classList.add('is-armed');
          armed.push(node);
        }
      });

      var reveal = function (node) {
        if (!node.classList.contains('is-in')) node.classList.add('is-in');
      };

      var observer = new IntersectionObserver(function (entries, self) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          reveal(entry.target);
          self.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
      armed.forEach(function (node) { observer.observe(node); });

      // 兜底：万一观察器没触发，滚动时按位置补一次
      window.addEventListener('scroll', function () {
        for (var i = 0; i < armed.length; i += 1) {
          var node = armed[i];
          if (node.classList.contains('is-in')) continue;
          if (node.getBoundingClientRect().top < window.innerHeight * 0.94) reveal(node);
        }
      }, { passive: true });
    }

    /* 7.3 记忆连接线：进入视口点亮一次 */
    if (steps) {
      if (Performance.reduced || !('IntersectionObserver' in window)) {
        steps.classList.add('is-lit');
      } else {
        var stepObserver = new IntersectionObserver(function (entries, self) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            steps.classList.add('is-lit');
            self.unobserve(entry.target);
          });
        }, { threshold: 0.35 });
        stepObserver.observe(steps);
      }
    }

    /* 7.4 导航当前章节 */
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
          if (!link) return;
          if (entry.isIntersecting) {
            links.forEach(function (l) { l.classList.remove('is-current'); });
            link.classList.add('is-current');
          }
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      Object.keys(map).forEach(function (id) { sectionObserver.observe(document.getElementById(id)); });
    }
  }

  /* ======================================================================
     8. 世界切换
     ====================================================================== */
  function initTabs() {
    var list = document.querySelector('.tabs');
    var stage = document.getElementById('world-stage');
    if (!list) return;
    var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
    if (!tabs.length) return;

    var panels = tabs.map(function (tab) {
      return document.getElementById(tab.getAttribute('aria-controls') || '');
    });

    function select(index, moveFocus) {
      var key = ['map', 'scene', 'timeline'][index] || 'map';
      tabs.forEach(function (tab, i) {
        var active = i === index;
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        tab.tabIndex = active ? 0 : -1;
        var panel = panels[i];
        if (!panel) return;
        if (active) {
          panel.hidden = false;
          panel.classList.add('is-entering');
          // 强制一次样式读取：从 display:none 切出来也能走过渡，而不是硬切
          void panel.offsetHeight;
          window.requestAnimationFrame(function () { panel.classList.remove('is-entering'); });
        } else {
          panel.hidden = true;
          panel.classList.remove('is-entering');
        }
      });
      if (stage) stage.setAttribute('data-world', key);
      if (moveFocus) tabs[index].focus();
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { select(i, false); });
    });

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

    // 隐藏面板里的截图浏览器不会提前下载：接近世界区域时预热一次
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
     9. Lightbox —— 打开/关闭都有过渡，快速切换不会被旧定时器覆盖
     ====================================================================== */
  function initLightbox() {
    var box = document.getElementById('lightbox');
    var image = document.getElementById('lightbox-image');
    var caption = document.getElementById('lightbox-caption');
    var closeButton = box ? box.querySelector('.lightbox-close') : null;
    if (!box || !image || !caption || !closeButton) return;

    var CLOSE_MS = 340;
    var lastFocus = null;
    var previousOverflow = '';
    var token = 0;
    var hideTimer = 0;

    function open(trigger) {
      var source = trigger.getAttribute('data-full');
      if (!source) return;
      token += 1;
      var myToken = token;
      window.clearTimeout(hideTimer);
      lastFocus = document.activeElement;
      previousOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';

      image.setAttribute('src', source);
      var inner = trigger.querySelector('img');
      image.setAttribute('alt', inner ? inner.getAttribute('alt') || '' : '');
      caption.textContent = trigger.getAttribute('data-caption') || '';

      box.hidden = false;
      void box.offsetHeight;
      window.requestAnimationFrame(function () {
        if (myToken !== token) return;
        box.classList.add('is-open');
      });
      closeButton.focus();
    }

    function close() {
      token += 1;
      var myToken = token;
      box.classList.remove('is-open');
      document.documentElement.style.overflow = previousOverflow;
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
      hideTimer = window.setTimeout(function () {
        if (myToken !== token) return; // 已经被下一次打开取代
        box.hidden = true;
        image.removeAttribute('src');
        caption.textContent = '';
      }, CLOSE_MS);
    }

    Array.prototype.forEach.call(document.querySelectorAll('.shot-open'), function (trigger) {
      trigger.addEventListener('click', function () { open(trigger); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-lightbox-close]'), function (node) {
      node.addEventListener('click', close);
    });

    document.addEventListener('keydown', function (event) {
      if (box.hidden) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key === 'Tab') { event.preventDefault(); closeButton.focus(); }
    });

    Array.prototype.forEach.call(document.querySelectorAll('a[href^="#"]'), function (link) {
      link.addEventListener('click', function () { if (!box.hidden) close(); });
    });
  }

  /* ======================================================================
     10. AmbientSync —— 环境光跟着内容走；标签页隐藏时停掉所有持续动画
     ====================================================================== */
  function initAmbient() {
    var backlight = document.getElementById('vg-hero-backlight');
    var heroVisual = document.querySelector('.hero-visual');

    var sync = function () {
      if (backlight && heroVisual) {
        var rect = heroVisual.getBoundingClientRect();
        if (rect.width > 0) {
          backlight.style.left = rect.left + rect.width * 0.5 + 'px';
          backlight.style.top = rect.top + rect.height * 0.42 + 'px';
          backlight.style.width = rect.width * 2.6 + 'px';
          backlight.style.height = rect.width * 2.6 + 'px';
          backlight.style.marginLeft = -rect.width * 1.3 + 'px';
        }
      }
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

    // 标签页不可见 → 暂停 CSS 持续动画（省电，也让截图稳定）
    var setPaused = function (paused) {
      root.classList.toggle('is-paused', paused);
    };
    document.addEventListener('visibilitychange', function () { setPaused(document.hidden); });
    setPaused(document.hidden);
  }

  /* ======================================================================
     启动
     ====================================================================== */
  var modules = [
    initPointerVars,
    initParticles,
    initDepth,
    initTilt,
    initMagnetic,
    initScroll,
    initTabs,
    initLightbox,
    initAmbient,
  ];

  modules.forEach(function (init) {
    try {
      init();
    } catch (error) {
      if (window.console && window.console.warn) window.console.warn('[virtugene] init failed:', error);
    }
  });

  Ticker.start();
  if (Performance.reduced) Ticker.stop();

  // 运行中切换"减少动态"时，直接停掉持续动画（无需刷新）
  var onMotionChange = function () {
    var reduced = motionQuery.matches;
    root.classList.toggle('reduced-motion', reduced);
    if (reduced) Ticker.stop();
    else Ticker.start();
  };
  if (motionQuery.addEventListener) motionQuery.addEventListener('change', onMotionChange);
  else if (motionQuery.addListener) motionQuery.addListener(onMotionChange);
})();
