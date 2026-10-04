(function () {
  'use strict';
  var section = document.getElementById('release-6');
  if (!section) return;
  var tabs = Array.from(section.querySelectorAll('[data-release-tab]'));
  var panels = Array.from(section.querySelectorAll('.release-panel'));
  function select(tab, focus) {
    tabs.forEach(function (item) {
      var active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
    });
    panels.forEach(function (panel) {
      panel.hidden = panel.id !== tab.getAttribute('aria-controls');
      var video = panel.querySelector('video');
      if (panel.hidden && video) video.pause();
    });
    if (focus) tab.focus();
  }
  tabs.forEach(function (tab, index) {
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
  var orbImage = document.getElementById('release-orb-image');
  var states = Array.from(section.querySelectorAll('[data-orb-state]'));
  states.forEach(function (button) {
    button.addEventListener('click', function () {
      states.forEach(function (item) { item.setAttribute('aria-pressed', String(item === button)); });
      orbImage.src = './assets/release-6/orb-' + button.dataset.orbState + '.svg';
      orbImage.alt = 'Soul Orb 小球，' + button.textContent + '表情';
    });
  });
  var video = section.querySelector('video');
  if (video) {
    document.addEventListener('visibilitychange', function () { if (document.hidden) video.pause(); });
    if ('IntersectionObserver' in window) new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) video.pause();
    }).observe(video);
  }
})();
