/* ==========================================================================
   VirtuGene 官网交互
   约定：
   - 每个交互各自初始化，任何一个出错都不会影响其它模块与静态内容。
   - 进入动画由 JS 先"武装"再播放：没有 JS 时内容默认可见（不会白屏）。
   - 全站只有 4 类动效：首屏光晕、区域进入、记忆连接线、世界切换（+ 图片查看淡入）。
   ========================================================================== */
(function () {
  'use strict';

  var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var reduced = motionQuery.matches;

  /* --- 01 导航：滚动后加一条分隔线 ------------------------------------- */
  function initNav() {
    var nav = document.getElementById('nav');
    if (!nav) return;
    var ticking = false;
    var update = function () {
      ticking = false;
      nav.classList.toggle('is-scrolled', window.scrollY > 8);
    };
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }, { passive: true });
    update();
  }

  /* --- 02 区域进入：淡入 + 12px 位移，只播一次 -------------------------- */
  var REVEAL_SELECTOR = [
    '.section-head',
    '.meet-body .shot',
    '.meet-points',
    '.steps',
    '.demo-note',
    '.memory-aside .shot',
    '.tabs',
    '.panels',
    '.platforms',
    '.download-notes'
  ].join(', ');

  function initReveal() {
    if (reduced || !('IntersectionObserver' in window)) return;
    var nodes = Array.prototype.slice.call(document.querySelectorAll(REVEAL_SELECTOR));
    if (!nodes.length) return;
    nodes.forEach(function (node) { node.classList.add('is-armed'); });

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
    nodes.forEach(function (node) { observer.observe(node); });

    // 兜底：万一观察器没触发，滚动时按位置补一次，内容不会永远藏着
    var ticking = false;
    var sweep = function () {
      ticking = false;
      nodes.forEach(function (node) {
        if (node.classList.contains('is-in')) return;
        var rect = node.getBoundingClientRect();
        if (rect.top < window.innerHeight * 0.92) reveal(node);
      });
    };
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(sweep);
    }, { passive: true });
    sweep();
  }

  /* --- 03 记忆连接线：进入视口点亮一次 --------------------------------- */
  function initSteps() {
    var steps = document.querySelector('[data-steps]');
    if (!steps) return;
    var light = function () { steps.classList.add('is-lit'); };
    if (reduced || !('IntersectionObserver' in window)) { light(); return; }
    var observer = new IntersectionObserver(function (entries, self) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        light();
        self.unobserve(entry.target);
      });
    }, { threshold: 0.35 });
    observer.observe(steps);
  }

  /* --- 04 世界切换：原生按钮 + ARIA tab 语义 --------------------------- */
  function initTabs() {
    var list = document.querySelector('.tabs');
    if (!list) return;
    var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
    if (!tabs.length) return;
    var panels = tabs.map(function (tab) {
      return document.getElementById(tab.getAttribute('aria-controls') || '');
    });

    var select = function (index, moveFocus) {
      tabs.forEach(function (tab, i) {
        var active = i === index;
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        tab.tabIndex = active ? 0 : -1;
        var panel = panels[i];
        if (!panel) return;
        if (active) {
          panel.hidden = false;
          panel.classList.add('is-entering');
          window.requestAnimationFrame(function () { panel.classList.remove('is-entering'); });
        } else {
          panel.hidden = true;
          panel.classList.remove('is-entering');
        }
      });
      if (moveFocus) tabs[index].focus();
    };

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

    // 初始状态以 HTML 中的 aria-selected 为准
    var initial = tabs.findIndex(function (tab) { return tab.getAttribute('aria-selected') === 'true'; });
    select(initial < 0 ? 0 : initial, false);

    // 隐藏面板里的截图浏览器不会提前下载，用户第一次切换时会看到空白。
    // 世界区域快进入视口时预热一次，切换时图片已经在缓存里。
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
    var stage = document.querySelector('.world-stage');
    if (stage && 'IntersectionObserver' in window) {
      var warner = new IntersectionObserver(function (entries, self) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          warmUp();
          self.disconnect();
        });
      }, { rootMargin: '300px 0px' });
      warner.observe(stage);
    } else {
      warmUp();
    }
  }

  /* --- 05 图片查看：关闭按钮 / Esc / 焦点 / 滚动位置 -------------------- */
  function initLightbox() {
    var box = document.getElementById('lightbox');
    var image = document.getElementById('lightbox-image');
    var caption = document.getElementById('lightbox-caption');
    var closeButton = box ? box.querySelector('.lightbox-close') : null;
    if (!box || !image || !caption || !closeButton) return;

    var lastFocus = null;
    var previousOverflow = '';
    var token = 0;
    var clearTimer = 0;

    var open = function (trigger) {
      var source = trigger.getAttribute('data-full');
      if (!source) return;
      token += 1;
      window.clearTimeout(clearTimer);
      lastFocus = document.activeElement;
      previousOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      image.setAttribute('src', source);
      var inner = trigger.querySelector('img');
      image.setAttribute('alt', inner ? inner.getAttribute('alt') || '' : '');
      caption.textContent = trigger.getAttribute('data-caption') || '';
      box.hidden = false;
      closeButton.focus();
    };

    var close = function () {
      var myToken = ++token;
      box.hidden = true;
      document.documentElement.style.overflow = previousOverflow;
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
      // 快速连续切换时，旧定时器不能再动新图片
      clearTimer = window.setTimeout(function () {
        if (myToken !== token) return;
        image.removeAttribute('src');
        caption.textContent = '';
      }, 260);
    };

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

  /* --- 06 首屏光晕：可见时才呼吸，离开或隐藏标签页即停止 ---------------- */
  function initHeroGlow() {
    var hero = document.querySelector('.hero');
    if (!hero) return;
    var inView = true;
    var sync = function () { hero.classList.toggle('is-visible', inView && !document.hidden); };

    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) { inView = entry.isIntersecting; });
        sync();
      }, { threshold: 0.05 });
      observer.observe(hero);
    } else {
      inView = true;
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        var rect = hero.getBoundingClientRect();
        inView = rect.bottom > 0 && rect.top < window.innerHeight;
      }
      sync();
    });
    sync();
  }

  var modules = [initNav, initReveal, initSteps, initTabs, initLightbox, initHeroGlow];
  modules.forEach(function (init) {
    try {
      init();
    } catch (error) {
      // 单个模块失败不影响其它模块，也不影响静态内容
      if (window.console && window.console.warn) window.console.warn('[virtugene] init failed', error);
    }
  });
})();
