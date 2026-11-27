(function () {
  'use strict';

  function initializeScenes() {
    var section = document.getElementById('experience');
    if (!section) return;
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    var animations = new Map();

    function cancelAnimations() {
      animations.forEach(function (animation) { animation.cancel(); });
      animations.clear();
    }

    function motionAllowed() {
      return !reduced.matches && document.documentElement.dataset.motion !== 'off';
    }

    var buttons = Array.from(section.querySelectorAll('[data-scene-toggle]'));
    buttons.forEach(function (button) {
      var target = document.getElementById(button.getAttribute('aria-controls'));
      if (!target || !section.contains(target)) return;
      var initial = button.closest('.scene-stage').querySelector('[data-scene-initial]');

      function setExpanded(expanded, animate) {
        var running = animations.get(target);
        if (running) { running.cancel(); animations.delete(target); }
        button.setAttribute('aria-expanded', String(expanded));
        button.textContent = button.getAttribute(expanded ? 'data-close-label' : 'data-open-label');
        target.hidden = !expanded;
        target.setAttribute('aria-hidden', String(!expanded));
        if (initial) {
          initial.hidden = expanded;
          initial.setAttribute('aria-hidden', String(expanded));
        }
        var visible = expanded ? target : initial;
        if (!visible || !animate || !motionAllowed() || !visible.animate) return;
        var animation = visible.animate([
          { opacity: 0, transform: 'translateY(6px)' },
          { opacity: 1, transform: 'translateY(0)' }
        ], { duration: 240, easing: 'cubic-bezier(.2,.75,.25,1)' });
        animations.set(target, animation);
        animation.onfinish = function () {
          if (animations.get(target) === animation) animations.delete(target);
        };
      }

      setExpanded(false, false);
      button.addEventListener('click', function () {
        // Inactive tabs remain in the sizing grid but never own interaction.
        var panel = button.closest('[role="tabpanel"]');
        if (panel && (panel.hidden || panel.inert)) return;
        setExpanded(button.getAttribute('aria-expanded') !== 'true', true);
      });
    });

    section.classList.add('scene-ready');
    new MutationObserver(function () {
      if (!motionAllowed()) cancelAnimations();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    if (reduced.addEventListener) reduced.addEventListener('change', function () {
      if (reduced.matches) cancelAnimations();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) cancelAnimations();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeScenes, { once: true });
  else initializeScenes();
})();
