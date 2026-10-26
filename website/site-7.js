(function () {
  'use strict';
  var showcase = document.querySelector('.v7-showcase');
  var tabs = Array.from(document.querySelectorAll('[data-demo]'));
  var panels = Array.from(document.querySelectorAll('.v7-showcase-panel'));
  function select(tab, focus) {
    tabs.forEach(function (item) { var active = item === tab; item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1; });
    panels.forEach(function (panel) { panel.hidden = panel.id !== tab.getAttribute('aria-controls'); });
    if (showcase) showcase.dataset.showcase = tab.dataset.demo;
    document.dispatchEvent(new Event('vg:content-change'));
    if (focus) tab.focus();
  }
  tabs.forEach(function (tab, index) {
    tab.disabled = false;
    tab.addEventListener('click', function () { select(tab, false); });
    tab.addEventListener('keydown', function (event) {
      var next;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); select(tabs[next], true); }
    });
  });

  // Retain direct links from the previous official website.
  var legacy = {'#release-6':'#experience','#meet':'#experience','#world':'#daily'};
  if (legacy[location.hash]) {
    var destination = legacy[location.hash];
    history.replaceState(null, '', destination);
    document.querySelector(destination).scrollIntoView();
  }

  var dialog = document.getElementById('recording-dialog');
  var open = document.getElementById('open-recording');
  var close = document.getElementById('close-recording');
  var video = dialog && dialog.querySelector('video');
  if (dialog && open && close && video) {
    open.addEventListener('click', function () {
      if (typeof dialog.showModal !== 'function') { location.href = './assets/v7/scenes.webm'; return; }
      dialog.showModal();
      document.dispatchEvent(new CustomEvent('vg:overlay-change', {detail: true}));
      close.focus();
    });
    close.addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('click', function (event) { if (event.target === dialog) { var rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
    dialog.addEventListener('close', function () { video.pause(); document.dispatchEvent(new CustomEvent('vg:overlay-change', {detail: false})); open.focus(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) video.pause(); });
  }

  // The existing viewer owns image navigation; keep every control keyboard reachable.
  var lightbox = document.getElementById('lightbox');
  if (lightbox) lightbox.addEventListener('keydown', function (event) {
    if (event.key !== 'Tab') return;
    event.stopPropagation();
    var controls = Array.from(lightbox.querySelectorAll('button')).filter(function (item) { return !item.disabled && item.getClientRects().length; });
    if (!controls.length) return;
    var index = controls.indexOf(document.activeElement);
    var next = (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
    event.preventDefault();
    controls[next].focus();
  });
})();
