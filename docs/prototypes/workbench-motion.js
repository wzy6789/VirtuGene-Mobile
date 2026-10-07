// Motion for the isolated action-cabin preview. Business commits remain synchronous.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const running = new Map();
  const ease = 'cubic-bezier(.22,1,.36,1)';
  const phone = document.querySelector('.phone');
  let view = '', drag = null, pressed = null, cancelledClick = null;

  function stop(el) {
    const animation = running.get(el);
    if (animation) { running.delete(el); animation.cancel(); }
  }
  function stopTree(root) {
    if (!root) return;
    for (const node of running.keys()) if (root === node || root.contains(node)) stop(node);
  }
  function animate(el, frames, duration = 320, options = {}) {
    stop(el);
    if (reduce.matches || document.hidden || !el.isConnected) return;
    const animation = el.animate(frames, {duration, easing:ease,...options});
    running.set(el, animation);
    const finish = () => { if (running.get(el) === animation) running.delete(el); };
    animation.onfinish = finish;
    animation.oncancel = finish;
    return animation;
  }
  // Sample an analytic spring into one compositor animation; no animation-frame loop.
  // The initial velocity is preserved when a released gesture returns to its resting place.
  function spring(el, from, velocity = 0, duration = 460) {
    const frequency = 20, damping = .9;
    const decay = damping * frequency, oscillation = frequency * Math.sqrt(1-damping*damping);
    const v = Math.max(-800,Math.min(800,velocity));
    const frames = Array.from({length:33},(_,i) => {
      const offset = i/32, t = offset*duration/1000;
      const y = Math.exp(-decay*t)*(from*Math.cos(oscillation*t)+(v+decay*from)/oscillation*Math.sin(oscillation*t));
      return {offset,transform:`translateY(${i === 32 ? 0 : y.toFixed(3)}px)`};
    });
    return animate(el,frames,duration,{easing:'linear'});
  }
  function enterPage(root, direction, previousOpacity) {
    animate(root,[{opacity:Math.max(.85,previousOpacity)},{opacity:1}],200);
    // Animate only visible structural groups, with a small lead/follow rhythm.
    const groups = [...root.children].filter(n => n.matches('.date,.stats,.focus,.page-title,.page-tools,.week-controls,.week-summary,.risk-intro,.capture-card,.assistant-entry,#project-results,.section-title'));
    const bounds = document.getElementById('content').getBoundingClientRect();
    const visible = groups.filter(n => { const r = n.getBoundingClientRect(); return r.bottom > bounds.top && r.top < bounds.bottom; }).slice(0,5);
    visible.forEach((node,i) => animate(node,[
      {opacity:.72,transform:`translate(${direction*8}px,${5+Math.min(i,3)*2}px)`},
      {opacity:1,transform:'translate(0,0)'}
    ],360,{delay:i*18}));
  }
  const nodeKey = node => node.nodeType === 1
    ? node.getAttribute('data-motion-key') || node.id ||
      (node.dataset.action ? 'action:' + node.dataset.action + ':' + (node.dataset.id || '') : '') ||
      ['nav','taskFilter','projectFilter','riskFilter','statFilter','selectTask'].map(k => node.dataset[k] ? k + ':' + node.dataset[k] : '').find(Boolean) || ''
    : '';
  const compatible = (a,b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName;

  // Keep unchanged controls, text and list identities instead of replacing the page.
  function reconcile(parent, next) {
    const old = [...parent.childNodes], keyed = new Map(old.filter(nodeKey).map(n => [nodeKey(n),n]));
    const plain = old.filter(n => !nodeKey(n));
    let plainIndex = 0, cursor = parent.firstChild;
    for (const fresh of [...next.childNodes]) {
      const key = nodeKey(fresh);
      let node = key ? keyed.get(key) : plain[plainIndex++];
      if (!node || !compatible(node,fresh)) node = fresh.cloneNode(true);
      if (node !== cursor) parent.insertBefore(node,cursor);
      cursor = node.nextSibling;
      if (node.isEqualNode(fresh)) continue;
      if (node.nodeType !== 1) { node.nodeValue = fresh.nodeValue; continue; }
      for (const attr of [...node.attributes]) {
        if (!fresh.hasAttribute(attr.name) && attr.name !== 'data-cabin-pressed') node.removeAttribute(attr.name);
      }
      for (const attr of fresh.attributes) {
        if (node.getAttribute(attr.name) !== attr.value) node.setAttribute(attr.name,attr.value);
      }
      // Checkbox state is a live property once a user has interacted with it.
      if (node instanceof HTMLInputElement && ['checkbox','radio'].includes(node.type)) node.checked = fresh.checked;
      const changedNumber = node.matches('.stat strong,.week-stats strong,.risk-intro strong,.tab-count') && node.textContent !== fresh.textContent;
      reconcile(node,fresh);
      if (changedNumber) animate(node,[{opacity:.25,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],240);
    }
    while (cursor) { const nextNode = cursor.nextSibling; cursor.remove(); cursor = nextNode; }
  }
  function patch(target, html, motion = true) {
    const fragment = document.createElement('template'); fragment.innerHTML = html;
    // Read positions in one batch. No geometry reads on the idle path or each frame.
    const before = new Map();
    const known = new Set(), arrivals = [];
    const focused = target.contains(document.activeElement) ? document.activeElement : null;
    const focusContainer = focused?.closest('.card,.focus');
    let bounds;
    if (motion && !reduce.matches && !document.hidden && !target.closest('[inert]')) {
      bounds = target.getBoundingClientRect();
      for (const node of [...target.querySelectorAll('[data-motion-key]')].slice(0,100)) {
        known.add(node);
        const rect = node.getBoundingClientRect();
        if (rect.bottom > bounds.top && rect.top < bounds.bottom) before.set(node,rect.top);
      }
    }
    // Capture the current visual positions before interrupting a previous rearrangement.
    for (const node of before.keys()) stop(node);
    reconcile(target,fragment.content);
    const moves = [];
    for (const [node,y] of before) {
      if (!node.isConnected) { stop(node); continue; }
      const delta = y - node.getBoundingClientRect().top;
      if (Math.abs(delta) > 1 && Math.abs(delta) < 240) moves.push([node,delta]);
    }
    if (bounds) {
      for (const node of [...target.querySelectorAll('[data-motion-key]')].slice(0,100)) {
        if (known.has(node) || arrivals.length >= 6) continue;
        const rect = node.getBoundingClientRect();
        if (rect.bottom > bounds.top && rect.top < bounds.bottom) arrivals.push(node);
      }
    }
    for (const [node,delta] of moves) animate(node,[{transform:`translateY(${delta}px)`},{transform:'translateY(0)'}]);
    for (const node of arrivals) animate(node,[{opacity:.45,transform:'translateY(7px)'},{opacity:1,transform:'translateY(0)'}],280);
    if (focused && !focused.isConnected) {
      const next = focusContainer?.isConnected && (focusContainer.querySelector('.check-hit') || focusContainer.querySelector('button'));
      (next || target.querySelector('.filter button.active'))?.focus({preventScroll:true});
    }
  }
  function tabs(target, html, index) {
    // The indicator survives renders; native transitions retarget from their current position.
    const current = target.querySelector('.cabin-tab-indicator')?.getAttribute('style') || `transform:translateX(${index * 100}%);`;
    patch(target,html + `<span class="cabin-tab-indicator" aria-hidden="true" style="${current}"></span>`,false);
    const indicator = target.querySelector('.cabin-tab-indicator');
    indicator.style.transform = `translateX(${index * 100}%)`;
  }
  function page(target, html, identity, resetScroll) {
    const changed = view !== identity;
    const oldIndex = ['today','projects','inbox','risks','week'].indexOf(view);
    const newIndex = ['today','projects','inbox','risks','week'].indexOf(identity);
    const scroll = target.scrollTop;
    if (changed) {
      const previousOpacity = target.firstElementChild ? Number(getComputedStyle(target.firstElementChild).opacity) : 1;
      stopTree(target.firstElementChild);
      target.innerHTML = html;
      const direction = oldIndex < 0 || newIndex < 0 ? 0 : newIndex < oldIndex ? -1 : 1;
      // Restore the requested scroll position before measuring the visible entrance groups.
      target.scrollTop = resetScroll ? 0 : scroll;
      enterPage(target.firstElementChild,direction,previousOpacity);
    } else patch(target,html);
    view = identity;
    target.scrollTop = resetScroll ? 0 : scroll;
  }
  function retire(el) {
    el.inert = true; el.setAttribute('aria-hidden','true');
    for (const node of [el,...el.querySelectorAll('*')]) {
      node.removeAttribute('id'); node.removeAttribute('role'); node.removeAttribute('aria-modal');
      for (const attr of [...node.attributes]) if (attr.name.startsWith('data-')) node.removeAttribute(attr.name);
      node.removeAttribute('name'); node.removeAttribute('tabindex');
      if (node.classList.contains('task-center')) node.classList.replace('task-center','cabin-retired-center');
    }
    el.classList.replace('sheet','cabin-sheet-ghost');
  }
  function removeGhosts(overlay) {
    for (const ghost of overlay.querySelectorAll('.cabin-sheet-exit')) {
      stop(ghost); for (const child of ghost.children) stop(child); ghost.remove();
    }
  }
  function sheet(overlay, html) {
    cancelDrag();
    const old = overlay.querySelector('.sheet-wrap');
    const opacity = old ? Number(getComputedStyle(old).opacity) : 0;
    if (old) stopTree(old);
    else removeGhosts(overlay);
    const template = document.createElement('template'); template.innerHTML = html;
    const next = template.content.firstElementChild;
    if (old) {
      old.classList.remove('cabin-sheet-exit'); old.inert = false; old.removeAttribute('aria-hidden');
      old.replaceChildren(...next.childNodes);
      if (opacity < .99) animate(old,[{opacity},{opacity:1}],180);
    } else {
      overlay.replaceChildren(next);
      animate(next,[{opacity:0},{opacity:1}],240);
    }
    const panel = overlay.querySelector('.sheet');
    const distance = old ? 18 : 44;
    spring(panel,distance,-distance*7,old ? 380 : 460);
  }
  function hideSheet(overlay) {
    const wrap = overlay.querySelector('.sheet-wrap:not(.cabin-sheet-exit)');
    if (!wrap) return;
    const panel = wrap.querySelector('.sheet');
    const current = getComputedStyle(panel).transform;
    const currentY = current === 'none' ? 0 : new DOMMatrixReadOnly(current).m42;
    const currentOpacity = Number(getComputedStyle(wrap).opacity);
    const height = panel.getBoundingClientRect().height;
    cancelDrag(); stop(panel); stop(wrap); removeGhosts(overlay);
    if (reduce.matches || document.hidden) { wrap.remove(); return; }
    // Remove dialog semantics immediately, retaining a bounded, inert exit visual.
    retire(panel); panel.style.height = height + 'px';
    wrap.classList.add('cabin-sheet-exit'); wrap.inert = true; wrap.setAttribute('aria-hidden','true');
    animate(panel,[{transform:current === 'none' ? 'translateY(0)' : current,opacity:1},{transform:`translateY(${currentY+Math.max(24,height*.12)}px)`,opacity:0}],190);
    const animation = animate(wrap,[{opacity:currentOpacity},{opacity:0}],190);
    if (animation) animation.onfinish = () => { running.delete(wrap); stop(panel); wrap.remove(); };
    else wrap.remove();
  }

  function cancelDrag() {
    if (!drag) return;
    const state = drag; drag = null;
    cancelAnimationFrame(state.frame);
    state.panel.style.removeProperty('transform');
    state.panel.classList.remove('cabin-dragging');
    if (state.handle.hasPointerCapture(state.id)) state.handle.releasePointerCapture(state.id);
  }
  // Direction-locked dismissal is confined to the handle. Lists retain native scrolling.
  phone.addEventListener('pointerdown', e => {
    if (!e.isPrimary || e.button !== 0) return;
    cancelledClick = null;
    const handle = e.target.closest('.sheet > .handle');
    if (handle) {
      const panel = handle.closest('.sheet');
      const transform = getComputedStyle(panel).transform;
      const y = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
      stop(panel); panel.style.transform = `translateY(${y}px)`;
      drag = {panel,handle,id:e.pointerId,x:e.clientX,y:e.clientY,base:y,offset:y,lastY:e.clientY,lastTime:e.timeStamp,velocity:0,frame:0,locked:false};
      handle.setPointerCapture(e.pointerId);
    } else {
      const button = e.target.closest('button');
      if (button && !button.disabled && !button.closest('[inert]')) { pressed = {button,id:e.pointerId,rect:button.getBoundingClientRect(),inside:true}; button.dataset.cabinPressed = 'true'; }
    }
  });
  phone.addEventListener('pointermove', e => {
    if (pressed?.id === e.pointerId) {
      const rect = pressed.rect;
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      if (inside !== pressed.inside) { pressed.inside = inside; if (inside) pressed.button.dataset.cabinPressed = 'true'; else pressed.button.removeAttribute('data-cabin-pressed'); }
    }
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.locked) {
      if (Math.max(Math.abs(dx),Math.abs(dy)) < 7) return;
      if (Math.abs(dx) > Math.abs(dy)) { cancelDrag(); return; }
      drag.locked = true; drag.panel.classList.add('cabin-dragging');
    }
    const dt = e.timeStamp - drag.lastTime;
    if (dt > 0) drag.velocity = (e.clientY - drag.lastY) / dt;
    drag.lastY = e.clientY; drag.lastTime = e.timeStamp;
    // Resistance grows beyond the dismissal region; upward travel remains shallow.
    const value = drag.base + dy;
    drag.offset = value < 0 ? -12 * (1 - Math.exp(value / 55)) : value <= 120 ? value : 120 + 70 * (1 - Math.exp(-(value - 120) / 140));
    if (!drag.frame) drag.frame = requestAnimationFrame(() => {
      if (!drag) return;
      drag.frame = 0; drag.panel.style.transform = `translateY(${drag.offset}px)`;
    });
  });
  function release(e, cancelled = false) {
    if (pressed?.id === e.pointerId) {
      const {button,rect} = pressed;
      const outside = cancelled || e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
      button.removeAttribute('data-cabin-pressed'); pressed = null;
      if (outside) cancelledClick = {button,until:performance.now()+500};
    }
    if (!drag || drag.id !== e.pointerId) return;
    const state = drag;
    const dismiss = !cancelled && state.locked && (state.offset > 86 || state.offset > 28 && e.timeStamp - state.lastTime < 100 && state.velocity > .55);
    cancelAnimationFrame(state.frame);
    state.panel.style.transform = `translateY(${state.offset}px)`;
    if (dismiss) { window.close(); return; }
    cancelDrag();
    spring(state.panel,state.offset,e.timeStamp-state.lastTime < 100 ? state.velocity*1000 : 0);
  }
  window.addEventListener('pointerup', e => release(e));
  window.addEventListener('pointercancel', e => release(e,true));
  phone.addEventListener('lostpointercapture', e => { if (drag?.id === e.pointerId) release(e,true); });
  document.addEventListener('click', e => {
    if (e.detail && cancelledClick && performance.now() < cancelledClick.until && cancelledClick.button.contains(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); cancelledClick = null; }
  },true);
  phone.addEventListener('click', e => { if (e.target.matches('.sheet-wrap:not(.cabin-sheet-exit)')) window.close(); });
  function quiet() {
    cancelDrag();
    if (pressed) { pressed.button.removeAttribute('data-cabin-pressed'); pressed = null; }
    for (const [el] of running) stop(el);
    removeGhosts(document.getElementById('overlay'));
  }
  reduce.addEventListener('change', () => { if (reduce.matches) quiet(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) quiet(); });
  window.addEventListener('blur', () => { cancelDrag(); if (pressed) { pressed.button.removeAttribute('data-cabin-pressed'); pressed = null; } });
  window.WorkbenchMotion = {patch,tabs,page,sheet,hideSheet,animate};
})();
