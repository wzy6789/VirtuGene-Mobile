// Additional preview workflows use the same tasks, completion events and commit function.
const themeKey = 'virtugene:workbench-design:theme';
let theme = 'dark', pendingRestore = null, restoreRequest = 0;
try { theme = localStorage.getItem(themeKey) === 'light' ? 'light' : 'dark'; } catch {}
function applyTheme() {
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('[data-action="toggle-theme"]').forEach(b => b.setAttribute('aria-label', theme === 'dark' ? '切换为浅色主题' : '切换为深色主题'));
}
applyTheme(); showStorageIssue();
function centerTasks() {
  return data.tasks.filter(t => (taskView.status === 'all' || taskView.status === 'active' && active(t) || taskView.status === 'expired-focus' && isExpiredFocus(t) || taskView.status === 'unscheduled' && active(t) && !t.due || t.status === taskView.status)
    && (taskView.project === 'all' || t.project === taskView.project || taskView.project === 'none' && !t.project)
    && `${t.title} ${projectName(t.project)} ${t.waitingFor || ''} ${t.note || ''}`.toLowerCase().includes(taskView.query.toLowerCase().trim()))
    .sort((a,b) => Number(!active(a))-Number(!active(b)) || taskScore(a)-taskScore(b) || (a.due || '9999').localeCompare(b.due || '9999') || (a.time || '23:59').localeCompare(b.time || '23:59') || a.id.localeCompare(b.id));
}
function taskCenter(restorePosition = false) {
  sheet('全部任务', `<div class="task-center"><div class="task-center-tools"><span>${data.tasks.filter(active).length} 项待推进</span><div class="center-header-actions"><button class="quiet-button" data-action="new-center-task">${icon('plus',14)} 新任务</button><button class="quiet-button" data-action="toggle-selection">${taskView.select ? '结束选择' : '批量安排'}</button></div></div>
    <div class="filter">${[['active','未完成'],['expired-focus','过期重点 '+data.tasks.filter(isExpiredFocus).length],['unscheduled','未排期'],['doing','进行中'],['waiting','等对方'],['blocked','阻塞'],['completed','完成'],['cancelled','取消'],['all','全部']].map(([k,l]) => `<button data-center-status="${k}" class="${taskView.status === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    <label class="search-box"><span class="sr-only">搜索任务</span><input id="task-search" placeholder="搜索任务、备注或等待对象…" value="${esc(taskView.query)}" autocomplete="off"><button data-action="clear-task-search" aria-label="清除任务搜索">${icon('close',15)}</button></label>
    <label class="task-center-project">所属项目<select id="task-project"><option value="all">全部项目与独立事项</option><option value="none" ${taskView.project === 'none' ? 'selected' : ''}>独立事项</option>${data.projects.map(p => `<option value="${esc(p.id)}" ${taskView.project === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    ${taskView.status === 'expired-focus' ? '<p class="sheet-desc">所有早于今天、尚未完成的重点都保留在这里。可选中后接续为今日重点，或清除重点；清除不取消任务。</p>' : ''}<div id="task-center-results"></div><div id="batch-toolbar"></div></div>`);
  refreshTaskCenter();
  if (restorePosition) {
    document.getElementById('task-center-results').scrollTop = centerScroll;
    if (centerFocusId) document.querySelector(`.task-center [data-action="edit"][data-id="${centerFocusId}"]`)?.focus({preventScroll:true});
  }
}
function refreshTaskCenter() {
  const target = document.getElementById('task-center-results'); if (!target) return;
  const focusedTask = document.activeElement?.dataset.selectTask;
  const scroll = target.scrollTop;
  const list = centerTasks(), visible = list.slice(0,taskView.limit);
  taskView.ids = new Set([...taskView.ids].filter(id => data.tasks.some(t => t.id === id && active(t))));
  WorkbenchMotion.patch(target, `${taskView.select ? `<button class="quiet-button" data-action="select-visible">选择当前显示的待办（${visible.filter(active).length} 项）</button>` : ''}
    <div class="card">${visible.map(t => `<div class="task-center-row" data-motion-key="center-${esc(t.id)}">${taskView.select ? `<label class="selection-control"><input type="checkbox" data-select-task="${esc(t.id)}" aria-label="选择：${esc(t.title)}" ${taskView.ids.has(t.id) ? 'checked' : ''} ${active(t) ? '' : 'disabled'}></label>` : ''}${t.status === 'cancelled' ? `<div class="task-row"><div class="task-main"><button class="task-title" data-action="edit" data-id="${esc(t.id)}">${esc(t.title)}</button><div class="meta">已取消 · ${esc(projectName(t.project))}</div></div></div>` : taskRow(t)}</div>`).join('') || empty('没有符合筛选的任务。试试其他状态或关键词。')}</div>
    <p class="sheet-desc" style="margin-top:12px" role="status" tabindex="-1">已显示 ${visible.length} / ${list.length} 项</p>${visible.length < list.length ? '<button class="full-btn outline-btn" data-action="load-more-tasks">再显示 100 项</button>' : ''}`,false);
  WorkbenchMotion.patch(document.getElementById('batch-toolbar'), taskView.select ? `<div class="batch-toolbar"><div class="count" aria-live="polite">已选 ${taskView.ids.size} 项 · 仅对所选待办生效</div><div class="batch-buttons">${[['batch-complete','完成'],['batch-date','改日期'],['batch-focus','今日重点'],['batch-clear-focus','清除重点'],['batch-cancel','取消']].map(([a,l]) => `<button data-action="${a}" ${taskView.ids.size ? '' : 'disabled'}>${l}</button>`).join('')}</div></div>` : '',false);
  if (focusedTask) document.querySelector(`[data-select-task="${focusedTask}"]`)?.focus({preventScroll:true});
  target.scrollTop = scroll;
}
function followupSheet(id) {
  const task = data.tasks.find(t => t.id === id && t.status === 'waiting'); if (!task) return;
  sheet('安排下一次跟进', `<div class="source-preview"><span>等对方 · ${esc(projectName(task.project))}</span><p>${esc(task.title)}</p></div><form id="followup-form" data-id="${esc(id)}"><label>跟进对象<input name="waitingFor" maxlength="80" value="${esc(task.waitingFor)}" placeholder="对方或联系人，可留空"></label><label>下次跟进日期<input name="followup" type="date" required min="${today}" value="${task.followup && task.followup >= today ? task.followup : dateAdd(today,1)}"></label><div class="quick-dates">${[[today,'今天'],[dateAdd(today,1),'明天'],[dateAdd(today,3),'三天后']].map(([date,label]) => `<button type="button" data-followup-date="${date}">${label}</button>`).join('')}</div><p class="waiting-hint">只调整跟进安排，保持等对方状态与原截止时间。今天跟进仍会保留提醒；没有向对方发送消息。</p><button class="full-btn" type="submit">保存跟进安排</button></form><button class="full-btn outline-btn" style="margin-top:12px" data-action="record-followup" data-task-id="${esc(id)}">补记已经发生的跟进</button>`);
}
function recordFollowupSheet(id) {
  const task = data.tasks.find(t => t.id === id && active(t)); if (!task) return;
  const earliest = task.createdDate || '', defaultDate = earliest && earliest > dateAdd(today,-1) ? earliest : dateAdd(today,-1);
  sheet('补记已跟进', `<div class="source-preview"><span>手动事实记录 · ${esc(projectName(task.project))}</span><p>${esc(task.title)}</p></div><form id="record-followup-form" data-id="${esc(id)}"><label>实际跟进日期<input name="at" type="date" required ${earliest ? `min="${esc(earliest)}"` : ''} max="${today}" value="${defaultDate}"></label>${earliest ? `<p class="sheet-desc">任务创建于 ${esc(earliest)}，跟进日期不得早于此日。</p>` : '<p class="sheet-desc">旧任务创建日期未知，未推测补记下限。</p>'}<label>跟进对象<input name="waitingFor" maxlength="80" value="${esc(task.waitingFor)}" placeholder="对方或联系人，可留空"></label><label>联系方式<select name="method">${Object.entries(followupMethods).map(([key,label]) => `<option value="${key}">${label}</option>`).join('')}</select></label><label id="followup-method-detail" hidden>具体方式<input name="methodDetail" maxlength="40" disabled placeholder="例如：工单、视频会议"></label><label>反馈或结果<textarea name="note" required maxlength="500" placeholder="写下已经发生的联系和反馈；未收到回复也可以如实记录。"></textarea></label><p class="waiting-hint">按实际日期计入复盘。只记录你确认发生的跟进，不更改下次提醒、截止日或任务状态，不向对方发送消息。</p><button class="full-btn" type="submit">确认保存已跟进记录</button></form>`);
}
function captureConfirmationPreview() {
  sheet('助理整理确认卡片 · 样式预览', `<p class="sheet-desc">以下为固定样式示例，尚未调用助理解析，不会写入任务。</p><div class="source-preview"><span>示例原话 · 手动粘贴</span><p>领导说下周一评审前，把客户案例补到演示材料里。</p></div><article class="confirmation-candidate"><span class="badge warn">需要你确认</span><h4>补充演示材料中的客户案例</h4><dl><dt>截止日期</dt><dd>待确认 · 原话为“下周一评审前”</dd><dt>所属项目</dt><dd>待你选择</dd><dt>知情范围</dt><dd>仅自己</dd></dl><p>先确认具体评审时间，再保存日期。正式版每项可编辑、勾选或舍弃；未确认的内容不会直接加入待办。</p></article><button class="full-btn" disabled style="margin-top:16px">确认加入 · 仅展示样式</button><button class="full-btn outline-btn" data-action="close" style="margin-top:12px">返回收集箱</button>`);
}
function followupEvent(task,kind,fields) {
  return {id:'e-'+crypto.randomUUID(),kind,taskId:task.id,title:task.title,project:task.project,projectName:projectName(task.project),at:today,recordedOn:today,waitingFor:task.waitingFor || '',...fields};
}
function recordFollowupPlan(task,followup,waitingFor) {
  if (followup === (task.followup || '') && waitingFor === (task.waitingFor || '')) return;
  data.events.push(followupEvent(task,'followup-planned',{followup,waitingFor,previousFollowup:task.followup || '',previousWaitingFor:task.waitingFor || ''}));
}
function selectedTasks() { return data.tasks.filter(t => taskView.ids.has(t.id) && active(t)); }
function selectedPreview() { return `<div class="card">${selectedTasks().map(t => `<div class="week-item">${esc(t.title)}<small>${esc(projectName(t.project))} · ${esc(dateLabel(t))}</small></div>`).join('')}</div>`; }
function runBatch(message, action) {
  const selected = selectedTasks(); if (!selected.length) return;
  if (change(`${message} ${selected.length} 项，可以撤销。`, () => selected.forEach(action))) {
    const undo = undoAction;
    taskView.ids.clear(); taskCenter();
    toast(`${message} ${selected.length} 项，可以撤销。`, undo);
  }
}
function dataPanel() {
  pendingRestore = null;
  sheet('数据与备份', `<p class="sheet-desc">这是行动舱设计原型的独立示例数据，包含 ${data.tasks.length} 项任务、${data.projects.length} 个项目和 ${data.captures.length} 条收集项。不会读取应用真实记录。</p><div class="backup-buttons"><button class="full-btn" data-action="export-backup">导出示例数据备份</button>${storageIssue?.type === 'invalid' ? '<button class="full-btn outline-btn" data-action="export-raw">导出原始备份（保留异常数据）</button>' : ''}<label class="backup-label">从备份恢复<input id="backup-file" type="file" accept=".json,application/json" aria-label="选择行动舱示例备份"></label></div><p class="backup-message" role="status">备份恢复前会校验格式、日期、关联项目和记录标识，并显示待恢复数量。确认后替换示例数据，可撤销。</p>`);
}
function download(name, content) {
  const link = document.createElement('a'), url = URL.createObjectURL(new Blob([content], {type:'application/json;charset=utf-8'}));
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const a = b.dataset.action;
  if (a === 'quick-followup') followupSheet(b.dataset.taskId);
  if (a === 'record-followup') recordFollowupSheet(b.dataset.taskId);
  if (a === 'capture-confirmation-preview') captureConfirmationPreview();
  if (b.dataset.followupDate) document.querySelector('#followup-form [name="followup"]').value = b.dataset.followupDate;
  if (b.dataset.centerStatus) { taskView.status = b.dataset.centerStatus; taskView.limit = 100; taskView.ids.clear(); taskCenter(); }
  if (a === 'toggle-theme') { theme = theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem(themeKey,theme); } catch {} applyTheme(); }
  if (a === 'task-center') { taskView.limit = 100; taskView.ids.clear(); taskCenter(); }
  if (a === 'new-center-task') editTask();
  if (a === 'toggle-selection') { taskView.select = !taskView.select; taskView.ids.clear(); taskCenter(); }
  if (a === 'select-visible') { centerTasks().slice(0,taskView.limit).filter(active).forEach(t => taskView.ids.add(t.id)); refreshTaskCenter(); }
  if (a === 'load-more-tasks') {
    const target = document.getElementById('task-center-results'), scroll = target.scrollTop;
    taskView.limit += 100; refreshTaskCenter(); target.scrollTop = scroll;
    (target.querySelector('[data-action="load-more-tasks"]') || target.querySelector('[role="status"]'))?.focus({preventScroll:true});
  }
  if (a === 'clear-task-search') { taskView.query = ''; taskView.limit = 100; taskView.ids.clear(); document.getElementById('task-search').value = ''; refreshTaskCenter(); document.getElementById('task-search').focus(); }
  if (a === 'batch-complete') runBatch('已完成', t => updateCompletion(t,'completed'));
  if (a === 'batch-focus') runBatch('已标记为今日重点', t => { t.focusDate = today; });
  if (a === 'batch-clear-focus') runBatch('已清除重点（任务保留）', t => { t.focusDate = ''; });
  if (a === 'batch-date') sheet('批量调整日期', `<p class="sheet-desc">只调整下面 ${selectedTasks().length} 项的截止日期，已有具体时间保留。</p>${selectedPreview()}<form id="batch-date-form"><label style="margin-top:14px">新的截止日期<input type="date" name="due" required value="${dateAdd(today,1)}"></label><button class="full-btn" type="submit">确认调整日期</button></form>`);
  if (a === 'batch-cancel') sheet('取消所选任务', `<p class="sheet-desc">以下 ${selectedTasks().length} 项将停止推进，记录保留。取消不算已完成工作。</p>${selectedPreview()}<div class="sheet-actions"><button class="full-btn outline-btn" data-action="return-task-center">保留任务</button><button class="full-btn" data-action="confirm-batch-cancel">确认取消</button></div>`);
  if (a === 'return-task-center') taskCenter();
  if (a === 'confirm-batch-cancel') runBatch('已取消', t => updateCompletion(t,'cancelled'));
  if (a === 'data-panel') dataPanel();
  if (a === 'export-backup') {
    const backupData = structuredClone(data); backupData.events.forEach(e => { e.kind ??= 'completed'; });
    download('virtugene-workbench-design-v4.json', JSON.stringify({format:'virtugene-workbench-design',version:4,data:backupData},null,2)); toast('已导出示例数据备份。');
  }
  if (a === 'export-raw' && lastSavedRaw !== null) download('virtugene-workbench-design-original.json',lastSavedRaw);
  if (a === 'confirm-restore' && pendingRestore) {
    const previousIssue = storageIssue; storageIssue = null;
    if (change('示例数据已恢复，可以撤销。', () => { data = structuredClone(pendingRestore); })) {
      close(); taskView.status = 'active'; taskView.project = 'all'; taskView.query = ''; taskView.select = false; taskView.ids.clear();
      projectFilter = 'active'; riskFilter = 'all'; taskFilter = 'due'; search = ''; weekOffset = 0;
      render(); pendingRestore = null;
    }
    else { storageIssue ||= previousIssue; showStorageIssue(); }
  }
  if (a === 'reload-data') sheet('重新载入示例数据', '<p class="sheet-desc">重新载入会采用其他窗口已保存的版本，当前未保存的输入不会保留。可以先导出当前记录，或复制正在编辑的草稿。</p><div class="sheet-actions"><button class="full-btn outline-btn" data-action="close">暂不载入</button><button class="full-btn" data-action="confirm-reload">重新载入</button></div>');
  if (a === 'confirm-reload') location.reload();
});
document.addEventListener('input', e => {
  if (e.target.id === 'task-search') { taskView.query = e.target.value; taskView.limit = 100; taskView.ids.clear(); refreshTaskCenter(); }
});
document.addEventListener('change', async e => {
  if (e.target.matches('#record-followup-form [name="method"]')) {
    const detail = document.getElementById('followup-method-detail'), input = detail.querySelector('input');
    const custom = e.target.value === 'other'; detail.hidden = !custom; input.disabled = !custom; input.required = custom;
  }
  if (e.target.dataset.selectTask) { if (e.target.checked) taskView.ids.add(e.target.dataset.selectTask); else taskView.ids.delete(e.target.dataset.selectTask); refreshTaskCenter(); }
  if (e.target.id === 'task-project') { taskView.project = e.target.value; taskView.limit = 100; taskView.ids.clear(); refreshTaskCenter(); }
  if (e.target.id === 'demo-time' && /^([01]\d|2[0-3]):[0-5]\d$/.test(e.target.value)) { demoTime = e.target.value; document.querySelector('.statusbar b').textContent = demoTime; render(false); }
  if (e.target.id === 'backup-file') {
    const file = e.target.files?.[0]; if (!file) return;
    const request = ++restoreRequest, input = e.target;
    const label = document.querySelector('.backup-message');
    try {
      if (file.size > 10*1024*1024) throw new Error('too large');
      const contents = await file.text();
      if (!input.isConnected || request !== restoreRequest) return;
      const parsed = JSON.parse(contents), restored = WorkbenchData.validate(parsed);
      if (!restored) throw new Error('invalid');
      restored.tasks.forEach(t => { if (t.focus && !t.focusDate) t.focusDate = today; delete t.focus; });
      restored.reviewDrafts ??= {};
      if (!restored.events) restored.events = restored.tasks.filter(done).map(t => ({id:'e-'+crypto.randomUUID(),taskId:t.id,title:t.title,project:t.project,projectName:restored.projects.find(p => p.id === t.project)?.name || '独立事项',at:t.completedAt}));
      pendingRestore = restored;
      sheet('恢复示例数据', `<p class="sheet-desc">格式校验通过。将恢复 ${restored.tasks.length} 项任务、${restored.projects.length} 个项目、${restored.captures.length} 条收集项，以及完成记录和复盘草稿。</p><p class="sheet-desc">确认后替换当前示例数据，可撤销。本操作只影响设计原型。</p><div class="sheet-actions"><button class="full-btn outline-btn" data-action="data-panel">暂不恢复</button><button class="full-btn" data-action="confirm-restore">确认恢复</button></div>`);
    } catch { if (input.isConnected && request === restoreRequest) { label.textContent = '无法恢复：备份格式或数据校验未通过（限 10 MB）。当前记录没有修改。'; label.style.color = 'var(--danger)'; input.value = ''; pendingRestore = null; } }
  }
});
document.addEventListener('submit', e => {
  if (e.target.id === 'followup-form') {
    e.preventDefault();
    const form = e.target, values = Object.fromEntries(new FormData(form));
    const task = data.tasks.find(t => t.id === form.dataset.id && t.status === 'waiting');
    if (!task || !WorkbenchData.date(values.followup) || values.followup < today) { toast('请选择今天或之后的跟进日期。'); return; }
    if (change('跟进安排已保存，尚未联系对方。', () => { recordFollowupPlan(task,values.followup,values.waitingFor.trim()); task.followup = values.followup; task.waitingFor = values.waitingFor.trim(); })) close();
  }
  if (e.target.id === 'record-followup-form') {
    e.preventDefault();
    const form = e.target, values = Object.fromEntries(new FormData(form));
    const task = data.tasks.find(t => t.id === form.dataset.id && active(t));
    if (!task || !WorkbenchData.date(values.at) || values.at > today || task.createdDate && values.at < task.createdDate || !Object.hasOwn(followupMethods,values.method) || !values.note.trim()) { toast('请填写任务创建日期至今天之间的真实跟进日期和结果。'); return; }
    const methodDetail = values.method === 'other' ? values.methodDetail?.trim() : undefined;
    if (values.method === 'other' && !methodDetail) { toast('请填写具体跟进方式。'); return; }
    if (change('已保存手动跟进记录，原提醒与任务状态保持原样。', () => { data.events.push(followupEvent(task,'followup-recorded',{at:values.at,waitingFor:values.waitingFor.trim(),method:values.method,methodDetail,taskCreatedDate:task.createdDate,note:values.note.trim()})); })) close();
  }
  if (e.target.id === 'carry-focus-form') {
    e.preventDefault();
    const ids = new Set(new FormData(e.target).getAll('taskId'));
    const selected = yesterdayFocus().filter(t => ids.has(t.id));
    if (!selected.length) { toast('请至少选择一件要接续的事项。'); return; }
    if (change(`已接续 ${selected.length} 件重点，可以撤销。`, () => selected.forEach(t => { t.focusDate = today; }))) close();
  }
  if (e.target.id === 'batch-date-form') {
    e.preventDefault(); const date = new FormData(e.target).get('due');
    if (WorkbenchData.date(date)) runBatch('已调整截止日期', t => { t.due = date; });
  }
});
window.addEventListener('storage', e => {
  if (e.key === key && e.newValue !== lastSavedRaw || e.key === null && lastSavedRaw !== null) {
    storageIssue = {type:'conflict',message:'另一个窗口更新了示例数据。已暂停写入，请先备份记录或复制未保存输入，再重新载入。'};
    showStorageIssue();
  }
});
