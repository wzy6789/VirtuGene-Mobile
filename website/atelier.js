(function () {
  'use strict';

  function initialize() {
    var root = document.documentElement;
    var menuButton = document.querySelector('.menu-toggle');
    var menu = document.getElementById('mobile-menu');
    var updateTabIndicators = [];
    var stopTabMotion = [];

    function setMenu(open, restoreFocus) {
      if (!menuButton || !menu) return;
      menu.hidden = !open;
      menuButton.setAttribute('aria-expanded', String(open));
      menuButton.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
      if (restoreFocus) menuButton.focus();
    }

    if (menuButton && menu) {
      setMenu(false);
      menuButton.addEventListener('click', function () { setMenu(menu.hidden); });
      menu.addEventListener('click', function (event) {
        if (event.target.closest('a')) setMenu(false);
      });
      document.addEventListener('click', function (event) {
        if (!menu.hidden && !menu.contains(event.target) && !menuButton.contains(event.target)) setMenu(false);
      });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && !menu.hidden) setMenu(false, true);
      });
    }

    document.querySelectorAll('[role="tablist"]').forEach(function (list) {
      var tabs = Array.from(list.querySelectorAll('[role="tab"]')).filter(function (tab) {
        var panel = document.getElementById(tab.getAttribute('aria-controls'));
        return tab.closest('[role="tablist"]') === list && panel && panel.getAttribute('role') === 'tabpanel';
      });
      if (!tabs.length) return;
      var animations = [];

      function cancelMotion() {
        animations.forEach(function (animation) { animation.cancel(); });
        animations = [];
      }
      stopTabMotion.push(cancelMotion);

      function updateIndicator() {
        var selected = tabs.find(function (tab) { return tab.getAttribute('aria-selected') === 'true'; });
        if (!selected) return;
        list.style.setProperty('--tab-x', selected.offsetLeft + 'px');
        list.style.setProperty('--tab-width', selected.getBoundingClientRect().width + 'px');
      }
      updateTabIndicators.push(updateIndicator);
      if (window.ResizeObserver) new ResizeObserver(updateIndicator).observe(list);

      function select(selected, focus, animate) {
        var changed = selected.getAttribute('aria-selected') !== 'true';
        cancelMotion();
        tabs.forEach(function (tab) {
          var active = tab === selected;
          tab.disabled = false;
          tab.setAttribute('aria-selected', String(active));
          tab.tabIndex = active ? 0 : -1;
          var panel = document.getElementById(tab.getAttribute('aria-controls'));
          panel.hidden = !active;
          panel.inert = !active;
          panel.setAttribute('aria-hidden', String(!active));
        });
        updateIndicator();
        if (changed && animate && root.dataset.motion === 'on') {
          var panel = document.getElementById(selected.getAttribute('aria-controls'));
          Array.from(panel.children).forEach(function (content) {
            if (!content.animate) return;
            animations.push(content.animate([
              { opacity: 0, transform: 'translateY(7px)' },
              { opacity: 1, transform: 'translateY(0)' }
            ], { duration: 220, easing: 'cubic-bezier(.2,.75,.25,1)' }));
          });
        }
        if (focus) selected.focus({ preventScroll: true });
      }

      select(tabs.find(function (tab) { return tab.getAttribute('aria-selected') === 'true'; }) || tabs[0]);
      tabs.forEach(function (tab, index) {
        tab.addEventListener('click', function () { select(tab, false, true); });
        tab.addEventListener('keydown', function (event) {
          var next;
          if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = tabs.length - 1;
          else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + tabs.length - 1) % tabs.length;
          if (next === undefined) return;
          event.preventDefault();
          select(tabs[next], true, true);
        });
      });
    });

    function canEnhance(dialog) {
      return dialog && typeof dialog.showModal === 'function';
    }

    function isPlainClick(event) {
      return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && !event.defaultPrevented;
    }

    function restoreFocus(element) {
      if (element && element.isConnected && element.getClientRects().length) element.focus({ preventScroll: true });
    }

    function wireDialog(dialog, onClose) {
      dialog.querySelectorAll('[data-close]').forEach(function (button) {
        button.addEventListener('click', function () { dialog.close(); });
      });
      // A native dialog's backdrop reports the dialog as the target.
      // Check both pointer ends so dragging out of its content cannot close it.
      var startedOutside = false;
      function outside(event) {
        var bounds = dialog.getBoundingClientRect();
        return event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
      }
      dialog.addEventListener('pointerdown', function (event) { startedOutside = outside(event); });
      dialog.addEventListener('click', function (event) {
        if (startedOutside && outside(event)) dialog.close();
        startedOutside = false;
      });
      dialog.addEventListener('close', onClose);
    }

    var viewer = document.getElementById('image-viewer');
    var image = viewer && viewer.querySelector('img');
    var caption = viewer && viewer.querySelector('[data-caption-out]');
    var previous = viewer && viewer.querySelector('[data-prev]');
    var next = viewer && viewer.querySelector('[data-next]');
    var gallery = [];
    var current = 0;
    var imageOpener = null;

    if (canEnhance(viewer) && image) {
      function renderImage(index) {
        current = (index + gallery.length) % gallery.length;
        var link = gallery[current];
        var thumbnail = link.querySelector('img');
        image.src = link.href;
        image.alt = thumbnail ? thumbnail.alt : (link.getAttribute('data-caption') || '产品界面');
        if (caption) caption.textContent = link.getAttribute('data-caption') || '';
        if (previous) previous.disabled = gallery.length < 2;
        if (next) next.disabled = gallery.length < 2;
      }

      document.querySelectorAll('a[data-view]').forEach(function (link) {
        link.addEventListener('click', function (event) {
          if (!isPlainClick(event)) return;
          var scope = link.closest('[data-gallery]') || link.closest('section') || link.parentElement;
          var seen = new Set();
          gallery = Array.from(scope.querySelectorAll('a[data-view]')).filter(function (candidate) {
            var visible = candidate.getClientRects().length && getComputedStyle(candidate).visibility !== 'hidden';
            if (!visible || seen.has(candidate.href)) return false;
            seen.add(candidate.href);
            return true;
          });
          if (!gallery.length) return;
          event.preventDefault();
          imageOpener = link;
          setMenu(false);
          renderImage(gallery.findIndex(function (candidate) { return candidate.href === link.href; }));
          viewer.showModal();
        });
      });

      if (previous) previous.addEventListener('click', function () { renderImage(current - 1); });
      if (next) next.addEventListener('click', function () { renderImage(current + 1); });
      viewer.addEventListener('keydown', function (event) {
        if (event.key === 'Tab') {
          var controls = Array.from(viewer.querySelectorAll('button, a[href], [tabindex]')).filter(function (control) {
            return !control.disabled && control.tabIndex >= 0 && control.getClientRects().length;
          });
          if (!controls.length) return;
          var first = controls[0];
          var last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
          return;
        }
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        renderImage(current + (event.key === 'ArrowLeft' ? -1 : 1));
      });
      wireDialog(viewer, function () {
        image.removeAttribute('src');
        image.alt = '';
        if (caption) caption.textContent = '';
        restoreFocus(imageOpener);
      });
    }

    var film = document.getElementById('film-viewer');
    var video = film && film.querySelector('video');
    var filmOpener = null;
    if (canEnhance(film) && video) {
      video.autoplay = false;
      video.controls = true;
      video.preload = 'none';
      document.querySelectorAll('a[data-film]').forEach(function (link) {
        link.addEventListener('click', function (event) {
          if (!isPlainClick(event)) return;
          event.preventDefault();
          filmOpener = link;
          setMenu(false);
          video.pause();
          // Keep an existing source untouched so repeat opens preserve position.
          if (!video.getAttribute('src') && !video.querySelector('source[src]')) video.src = link.href;
          film.showModal();
        });
      });
      wireDialog(film, function () {
        video.pause();
        restoreFocus(filmOpener);
      });
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) video.pause();
      });
    }

    var motionButton = document.getElementById('motion-toggle');
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    var motionWanted = true;
    try { motionWanted = localStorage.getItem('virtugene-site-motion') !== 'off'; } catch (_) { /* Storage may be unavailable. */ }
    function applyMotion() {
      var enabled = motionWanted && !reduced.matches;
      root.dataset.motion = enabled ? 'on' : 'off';
      root.classList.toggle('motion-off', !enabled);
      if (!enabled) stopTabMotion.forEach(function (stop) { stop(); });
      if (!motionButton) return;
      motionButton.setAttribute('aria-pressed', String(enabled));
      motionButton.disabled = reduced.matches;
      motionButton.title = reduced.matches ? '系统已开启减少动态效果' : '';
      var label = motionButton.querySelector('[data-motion-label]');
      if (label) label.textContent = enabled ? '开启' : '关闭';
    }
    if (motionButton) motionButton.addEventListener('click', function () {
      motionWanted = !motionWanted;
      try { localStorage.setItem('virtugene-site-motion', motionWanted ? 'on' : 'off'); } catch (_) { /* Keep the session preference. */ }
      applyMotion();
    });
    if (reduced.addEventListener) reduced.addEventListener('change', applyMotion);
    else if (reduced.addListener) reduced.addListener(applyMotion);
    applyMotion();

    root.classList.add('js');
    updateTabIndicators.forEach(function (update) { update(); });
    if (document.fonts) document.fonts.ready.then(function () {
      updateTabIndicators.forEach(function (update) { update(); });
    });
    var aliases = { '#release-6': '#experience', '#meet': '#experience', '#world': '#daily' };
    function resolveLegacyAnchor() {
      var destination = aliases[location.hash];
      if (!destination || !document.querySelector(destination)) return;
      history.replaceState(history.state, '', destination);
      document.querySelector(destination).scrollIntoView({ behavior: 'instant' });
    }
    window.addEventListener('hashchange', resolveLegacyAnchor);
    resolveLegacyAnchor();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
