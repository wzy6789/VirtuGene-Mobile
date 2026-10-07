// Design prototype only. Its storage is isolated from VirtuGene's application DB.
const paths = {
  plus:'M12 5v14M5 12h14', check:'m5 12 4 4 10-10', arrow:'m9 5 7 7-7 7',
  back:'m15 5-7 7 7 7', calendar:'M7 3v4M17 3v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1',
  inbox:'M4 4h16v16H4zM4 14h5l1 3h4l1-3h5', message:'M4 4h16v13H9l-5 4z',
  world:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18',
  user:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-2a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v2',
  close:'m6 6 12 12M18 6 6 18', clock:'M12 8v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18'
};
const icon = (name, size = 19) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name] || paths.arrow}"/></svg>`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = '2026-10-03', key = 'virtugene:workbench-design:v1';
const dateAdd = (date, amount) => new Date(Date.parse(date + 'T12:00:00Z') + amount * 86400000).toISOString().slice(0, 10);
const days = date => date ? Math.round((Date.parse(date + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000) : null;
const active = t => ['todo', 'doing', 'waiting', 'blocked'].includes(t.status);
const done = t => t.status === 'completed';
const names = {today:'今日', projects:'项目', inbox:'收集箱', risks:'风险', week:'复盘'};
const priorities = {normal:'普通', important:'重要', urgent:'紧急'};
const statuses = {todo:'待办', doing:'进行中', waiting:'等对方', blocked:'阻塞', completed:'已完成', cancelled:'已取消'};
const riskLabels = {all:'全部', overdue:'延期', soon:'临期', blocked:'阻塞', waiting:'待跟进'};
let page = 'today', mode = 'workbench', taskFilter = 'due', projectFilter = 'active', riskFilter = 'all';
let weekOffset = 0, search = '', undoAction, toastTimer, pendingProject, returnFocus;
let demoTime = '09:41', lastSavedRaw = null, storageIssue = null;
let taskEditorReturn = false;
let centerScroll = 0, centerFocusId = null;
const taskView = {status:'active',project:'all',query:'',select:false,ids:new Set(),limit:100};

const seed = {
  projects: [
    {id:'p1',name:'秋季产品发布',description:'准备产品发布材料，与设计及研发确认最后一轮交付。',start:'2026-09-21',due:'2026-10-05',priority:'important',blocked:false,next:'先确认最终方案，再完成演示材料。',note:'周一进行最后一次联审。'},
    {id:'p2',name:'客户方案交付',description:'整理报价和客户方案，等待对方确认预算。',start:'2026-09-25',due:'2026-10-09',priority:'important',blocked:true,next:'跟进客户预算确认，收到反馈后补充报价。',note:'预算未确认前不提交最终报价。'},
    {id:'p3',name:'内部流程整理',description:'更新操作手册和新人入职清单。',start:'2026-09-28',due:'2026-10-16',priority:'normal',blocked:false,next:'补齐新人入职清单的负责人。',note:''}
  ],
  tasks: [
    {id:'t1',title:'确认发布方案的最终版本',project:'p1',due:'2026-10-02',time:'18:00',priority:'important',status:'doing',note:'与设计确认第三版内容，保留修改记录。'},
    {id:'t2',title:'提交产品演示材料',project:'p1',due:today,time:'16:00',priority:'important',status:'todo',note:'材料中补充两个用户使用案例。'},
    {id:'t3',title:'整理会议后的需求清单',project:'p1',due:today,time:'18:00',priority:'normal',status:'todo',note:'先整理，待同事确认后再安排后续任务。'},
    {id:'t4',title:'跟进客户的预算确认',project:'p2',due:'2026-10-07',priority:'important',status:'waiting',waitingSince:'2026-09-29',waitingFor:'客户采购同事',followup:'2026-10-02',note:'等待预算范围确认；上次联系在周二。'},
    {id:'t5',title:'准备客户报价附件',project:'p2',due:'2026-10-08',priority:'normal',status:'blocked',note:'依赖预算确认，暂时无法填写最终报价。'},
    {id:'t6',title:'补齐新人入职清单',project:'p3',due:'2026-10-06',priority:'normal',status:'todo',focusDate:today,note:'核对行政和 IT 两部分。'},
    {id:'t7',title:'发送发布会议纪要',project:'p1',due:today,priority:'normal',status:'completed',completedAt:today},
    {id:'t8',title:'整理第一版演示框架',project:'p1',due:'2026-10-01',priority:'normal',status:'completed',completedAt:'2026-10-01'},
    {id:'t9',title:'核对客户需求范围',project:'p2',due:'2026-09-30',priority:'normal',status:'completed',completedAt:'2026-09-30'},
    {id:'t10',title:'更新操作手册目录',project:'p3',due:'2026-09-29',priority:'normal',status:'completed',completedAt:'2026-09-29'},
    {id:'t11',title:'和行政确认流程负责人',project:'p3',due:'2026-10-08',priority:'normal',status:'todo',focusDate:'2026-10-02'}
  ],
  captures: [
    {id:'i1',text:'领导说下周一评审前，把客户案例补到演示材料里。',source:'微信交代 · 手动粘贴',at:'09:12'},
    {id:'i2',text:'会议上提到，要做一份各项目当前阻塞点的汇总。',source:'会后速记',at:'昨天 17:40'},
    {id:'i3',text:'客户那边预算还没回复，今天问一下进展。',source:'临时想法',at:'昨天 15:20'}
  ],
  reviewDrafts: {}
};
const projectName = id => data.projects.find(p => p.id === id)?.name || '独立事项';
const completionEvent = t => ({id:'e-' + crypto.randomUUID(), kind:'completed', taskId:t.id, title:t.title, project:t.project, projectName:projectName(t.project), at:t.completedAt});
let data;
try {
  lastSavedRaw = localStorage.getItem(key);
  data = lastSavedRaw ? WorkbenchData.validate(JSON.parse(lastSavedRaw)) : structuredClone(seed);
  if (!data) { storageIssue = {type:'invalid',message:'示例数据无法读取，原数据已保留。可以导出原始备份或选择恢复。'}; data = structuredClone(seed); }
} catch { storageIssue = {type:'invalid',message:'示例数据无法读取，原数据已保留。可以导出原始备份或选择恢复。'}; data = structuredClone(seed); }
// Preserve earlier prototype data when advancing the design, without touching application storage.
data.tasks.forEach(t => { if (t.focus && !t.focusDate) t.focusDate = today; delete t.focus; });
if (!Array.isArray(data.events)) data.events = data.tasks.filter(t => done(t) && t.completedAt).map(completionEvent);
data.reviewDrafts ??= {};

function save() {
  if (storageIssue?.type === 'invalid' || storageIssue?.type === 'conflict') { showStorageIssue(); return false; }
  try {
    if (localStorage.getItem(key) !== lastSavedRaw) {
      storageIssue = {type:'conflict',message:'另一个窗口更新了示例数据。已暂停写入，请先备份记录或复制未保存输入，再重新载入。'};
      showStorageIssue(); return false;
    }
    if (!WorkbenchData.validate(data)) throw new Error('Invalid data');
    const serialized = JSON.stringify(data);
    localStorage.setItem(key,serialized); lastSavedRaw = serialized; storageIssue = null;
    showStorageIssue(); return true;
  } catch {
    storageIssue = {type:'write',message:'未能保存示例数据，当前操作没有写入。输入内容保留，可以重试或导出备份。'};
    showStorageIssue(); return false;
  }
}
function persist() { const saved = save(); render(false); return saved; }
function showStorageIssue() {
  let el = document.getElementById('storage-alert');
  if (!el) { el = document.createElement('div'); el.id = 'storage-alert'; el.className = 'storage-alert'; el.setAttribute('role','alert'); document.querySelector('.tabs').before(el); }
  el.hidden = !storageIssue;
  el.inert = !!document.querySelector('.sheet');
  el.innerHTML = storageIssue ? `${esc(storageIssue.message)} <button data-action="data-panel">数据与备份</button>${storageIssue.type === 'conflict' ? '<button data-action="reload-data">重新载入</button>' : ''}` : '';
}
function toast(text, undo) {
  clearTimeout(toastTimer); undoAction = undo;
  document.getElementById('toast').innerHTML = `<div class="toast" role="status"><span>${esc(text)}</span>${undo ? '<button data-action="undo">撤销</button>' : ''}</div>`;
  toastTimer = setTimeout(() => { document.getElementById('toast').innerHTML = ''; undoAction = null; }, 6000);
}
function change(message, mutation) {
  const before = structuredClone(data);
  mutation();
  if (!save()) { data = before; render(false); toast('修改未能保存，已恢复修改前的数据。'); return false; }
  render(false);
  toast(message, () => {
    const current = data; data = structuredClone(before);
    if (!save()) { data = current; render(false); toast('撤销未能保存，当前数据保持原样。'); return false; }
    render(false); if (document.querySelector('.task-center')) refreshTaskCenter(); return true;
  });
  return true;
}
function restoreClosedProjectTask(id) {
  const t = data.tasks.find(t => t.id === id);
  if (!t) return;
  close(); projectFilter = 'active';
  change('项目和任务已重新打开。', () => {
    const p = data.projects.find(p => p.id === t.project);
    if (p) p.completed = false;
    updateCompletion(t,'todo');
  });
}
const isFocus = t => t.focusDate === today;
const isExpiredFocus = t => active(t) && !!t.focusDate && t.focusDate < today;
const yesterdayFocus = () => data.tasks.filter(t => active(t) && t.focusDate === dateAdd(today,-1));
function carryFocusSheet() {
  const tasks = yesterdayFocus();
  if (!tasks.length) return;
  sheet('接续昨日重点', `<p class="sheet-desc">选择今天继续关注的事项。只修改重点日期，截止时间、状态和原有排序保持原样；等对方与阻塞仍不会进入可推进的三件事。</p><form id="carry-focus-form"><div class="card">${tasks.map(t => `<label class="carry-focus-choice"><input type="checkbox" name="taskId" value="${esc(t.id)}" checked><span>${esc(t.title)}<small>${esc(statuses[t.status])} · ${esc(dateLabel(t))}</small></span></label>`).join('')}</div><div class="sheet-actions"><button type="button" class="full-btn outline-btn" data-action="close">暂不接续</button><button class="full-btn" type="submit">将所选移到今日</button></div></form>`);
}
const overdue = t => !!t.due && (t.due < today || t.due === today && !!t.time && t.time < demoTime);
const dateLabel = t => !t.due ? '未定日期' : days(t.due) === 0 ? (overdue(t) ? '已过截止时间 · ' : '今天') + (t.time ? ' ' + t.time : '') : days(t.due) < 0 ? '逾期 ' + (-days(t.due)) + ' 天' : t.due.slice(5).replace('-','月') + '日' + (t.time ? ' ' + t.time : '');
const taskScore = t => overdue(t) && t.priority !== 'normal' ? 0 : t.due === today && t.priority !== 'normal' ? 1 : t.due === today ? 2 : isFocus(t) ? 3 : 4;
function topTasks() {
  return data.tasks.filter(t => active(t) && !['blocked','waiting'].includes(t.status))
    .sort((a,b) => taskScore(a)-taskScore(b) || (a.due || '9999').localeCompare(b.due || '9999') || (a.time || '23:59').localeCompare(b.time || '23:59') || a.id.localeCompare(b.id)).slice(0,3);
}
function projectInfo(p) {
  const tasks = data.tasks.filter(t => t.project === p.id && (active(t) || done(t)));
  const completed = tasks.filter(done).length, complete = !!p.completed, left = days(p.due);
  const blocked = !!p.blocked || tasks.some(t => active(t) && t.status === 'blocked');
  return {tasks,done:completed,complete,left,blocked,progress:tasks.length ? Math.round(completed/tasks.length*100) : null,
    state:complete ? '已完成' : blocked ? '阻塞' : p.due && left < 0 ? '已延期' : p.due && left <= 3 ? '临期' : '正常'};
}
function risks() {
  const out = [];
  data.tasks.filter(active).forEach(t => {
    const types = [];
    if (overdue(t)) types.push('overdue');
    if (t.due && !overdue(t) && days(t.due) >= 0 && days(t.due) <= 3) types.push('soon');
    if (t.status === 'blocked') types.push('blocked');
    if (t.status === 'waiting' && (t.followup ? t.followup <= today : t.waitingSince && -days(t.waitingSince) >= 3)) types.push('waiting');
    if (types.length) out.push({kind:'task',id:t.id,title:t.title,types,
      main:types.includes('overdue') ? 'overdue' : types.includes('blocked') ? 'blocked' : types.includes('waiting') ? 'waiting' : 'soon',
      description:t.status === 'waiting' ? `等待${t.waitingFor || '对方'}反馈${t.waitingSince ? ' · 已 ' + (-days(t.waitingSince)) + ' 天' : ''}${t.followup ? ' · 跟进日 ' + t.followup.slice(5) : ''}` : t.status === 'blocked' ? t.note || '暂时无法推进，请补充阻塞原因。' : dateLabel(t) + ' · ' + projectName(t.project)});
  });
  data.projects.forEach(p => {
    const info = projectInfo(p); if (info.complete) return;
    const types = [];
    if (p.due && info.left < 0) types.push('overdue');
    else if (p.due && info.left <= 3) types.push('soon');
    if (info.blocked) types.push('blocked');
    if (types.length) out.push({kind:'project',id:p.id,title:p.name,types,main:types.includes('overdue') ? 'overdue' : info.blocked ? 'blocked' : 'soon',description:`项目${info.state} · ${info.tasks.length-info.done} 项未完成 · ${p.next || '尚未填写下一步'}`});
  });
  return out.sort((a,b) => ['overdue','blocked','waiting','soon'].indexOf(a.main)-['overdue','blocked','waiting','soon'].indexOf(b.main));
}
const empty = (label, action = '') => `<div class="empty">${esc(label)}${action}</div>`;
function taskRow(t) {
  const completed = done(t);
  return `<div class="task-row" data-motion-key="task-${esc(t.id)}"><button class="check-hit" data-action="complete" data-id="${esc(t.id)}" aria-label="${completed ? '恢复' : '完成'}：${esc(t.title)}"><span class="check ${completed ? 'green' : ''}">${completed ? icon('check',13) : ''}</span></button><div class="task-main"><button class="task-title ${completed ? 'done-title' : ''}" data-action="edit" data-id="${esc(t.id)}">${esc(t.title)}</button><div class="meta">${esc(projectName(t.project))} · <span class="${overdue(t) && !completed ? 'red' : ''}">${esc(completed ? '完成于 ' + t.completedAt : dateLabel(t))}</span>${isFocus(t) ? ' · 今日重点' : isExpiredFocus(t) ? ' · 过期重点 '+esc(t.focusDate) : ''}</div></div>${['waiting','blocked'].includes(t.status) ? `<span class="badge ${t.status === 'blocked' ? 'danger' : 'warn'}">${statuses[t.status]}</span>` : `<span class="arrow">${icon('arrow',13)}</span>`}</div>`;
}
function todayPage() {
  const top = topTasks(), due = data.tasks.filter(t => active(t) && t.due === today), over = data.tasks.filter(t => active(t) && overdue(t));
  const waiting = data.tasks.filter(t => active(t) && t.status === 'waiting'), completed = data.tasks.filter(t => done(t) && t.completedAt === today);
  const groups = {due,over,waiting,done:completed};
  const reasons = ['已延期 · 重要','今天截止 · 重要','今天需要交付','你标记的今日重点','最近的下一步'];
  return `<div class="date"><span>10 月 3 日 · 星期六</span><button data-nav="projects">${data.projects.filter(p => !p.completed).length} 个项目进行中 ${icon('arrow',10)}</button></div>
    <div class="stats">${[['due',due.length,'今日待完成',''],['done',completed.length,'今日已完成','green'],['over',over.length,'已经延期','red'],['waiting',waiting.length,'等对方','']].map(([k,n,l,c]) => `<button class="stat" data-stat-filter="${k}"><strong class="${c}">${n}</strong><span>${l}</span></button>`).join('')}</div>
    <section class="focus"><div class="focus-head"><h3><svg class="cabin-sigil" aria-hidden="true" width="18" height="22" viewBox="0 0 18 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4 2c0 7 10 13 10 20M14 2C14 9 4 15 4 22M5 5h8M7 10h4M7 14h4M5 19h8"/></svg>今日重点</h3><span>${top.length ? '先做这 ' + top.length + ' 件' : '给今天留一点余地'}</span></div>
    ${top.map((t,i) => `<div class="focus-row" data-motion-key="focus-${esc(t.id)}"><span class="rank">0${i+1}</span><div class="focus-body"><button class="task-title" data-action="edit" data-id="${esc(t.id)}">${esc(t.title)}</button><div class="focus-detail"><div class="meta"><span class="focus-project" title="${esc(projectName(t.project))}">${esc(projectName(t.project))}</span><span class="focus-deadline">· ${esc(dateLabel(t))}</span></div><span class="reason ${taskScore(t)>1 ? 'quiet-reason' : ''}">${reasons[taskScore(t)]}</span></div></div><button class="check-hit" data-action="complete" data-id="${esc(t.id)}" aria-label="完成：${esc(t.title)}"><span class="check"></span></button></div>`).join('') || `<p class="focus-empty">暂无可推进的任务。先记下一件事，或者处理等待与阻塞。</p><button class="focus-add" data-action="capture">${icon('plus',15)} 先记下一件事</button>`}
    <div class="focus-footer"><button class="focus-foot" data-action="ranking">${icon('clock',12)} 排序依据 ${icon('arrow',10)}</button>${yesterdayFocus().length ? `<button class="carry-focus-notice" data-action="carry-focus" aria-label="昨天还有 ${yesterdayFocus().length} 件重点没完成，查看并接续"><span>昨天还有 ${yesterdayFocus().length} 件重点没完成</span>${icon('arrow',12)}</button>` : ''}</div></section>
    <div class="section-title" id="task-groups"><h3>接下来怎么安排</h3><button data-action="task-center">全部任务 ${data.tasks.filter(active).length} ${icon('arrow',12)}</button></div>
    <div class="filter">${[['due','今日截止',due],['over','已延期',over],['waiting','等对方',waiting],['done','今日完成',completed]].map(([k,l,v]) => `<button data-task-filter="${k}" class="${taskFilter===k ? 'active' : ''}">${l} ${v.length}</button>`).join('')}</div>
    <div class="card">${groups[taskFilter].map(taskRow).join('') || empty('这里暂时没有事项。', '<button class="quiet-button" data-action="task-center">查看全部任务与未排期事项</button>')}</div>
    <div class="section-title"><h3>正在推进的项目</h3><button data-nav="projects">全部项目 ${icon('arrow',12)}</button></div>${data.projects.filter(p => !p.completed).slice(0,2).map(projectCard).join('') || empty('还没有项目。', '<button class="quiet-button" data-action="new-project">创建第一个项目</button>')}`;
}
function projectCard(p) {
  const info = projectInfo(p);
  return `<article class="card project" data-motion-key="project-${esc(p.id)}"><button class="open-project" data-action="project" data-id="${esc(p.id)}"><div class="project-top"><h3>${esc(p.name)}</h3><span class="badge ${['阻塞','已延期'].includes(info.state) ? 'danger' : info.state === '临期' ? 'warn' : info.complete ? 'cyan' : 'neutral'}">${info.state}</span></div>
    ${info.progress !== null ? `<div class="progress"><i style="transform:scaleX(${info.progress / 100})"></i></div>` : '<div class="no-progress">暂无任务，添加后显示进度</div>'}
    <div class="project-meta"><span>${info.progress === null ? '暂无进度' : info.progress + '% · ' + (info.tasks.length-info.done) + ' 项未完成'}</span><span>${!p.due ? '未定截止日' : info.complete ? '已完成' : info.left < 0 ? '延期 ' + (-info.left) + ' 天' : info.left === 0 ? '今天截止' : '剩余 ' + info.left + ' 天'}</span></div><div class="next"><span>下一步</span>${esc(info.complete ? '回看项目记录' : p.next || '补充一个明确的下一步动作')}</div></button></article>`;
}
function projectsPage() {
  const projects = data.projects.filter(p => projectFilter === 'all' || (projectFilter === 'done' ? p.completed : !p.completed));
  return `<h3 class="page-title">项目中心</h3><p class="lead">看进展、看下一步，也看卡在哪里。</p><div class="page-tools"><div class="filter" style="margin:0">${[['active','进行中'],['done','已完成'],['all','全部']].map(([k,l]) => `<button data-project-filter="${k}" class="${projectFilter===k ? 'active' : ''}">${l}</button>`).join('')}</div><button class="quiet-button" data-action="new-project">${icon('plus',14)} 新项目</button></div>
    <label class="search-box"><span class="sr-only">搜索项目</span><input id="project-search" placeholder="搜索项目名称或下一步…" value="${esc(search)}" autocomplete="off"><button data-action="clear-search" aria-label="清除项目搜索">${icon('close',15)}</button></label>
    <div id="project-results">${projectResults(projects)}</div>`;
}
function projectResults(projects = data.projects.filter(p => projectFilter === 'all' || (projectFilter === 'done' ? p.completed : !p.completed))) {
  const list = projects.filter(p => (p.name + ' ' + p.next).toLowerCase().includes(search.toLowerCase().trim()));
  return list.map(projectCard).join('') || empty(search ? '没有匹配的项目，试试其他关键词。' : projectFilter === 'done' ? '完成的项目会保留在这里。' : '给几件相关的事一个共同的方向。', !search && projectFilter !== 'done' ? '<button class="quiet-button" data-action="new-project">创建第一个项目</button>' : '');
}
function inboxPage() {
  return `<div class="page-tools"><h3 class="page-title" style="margin:0">收集箱</h3><span class="badge">${data.captures.length} 条待整理</span></div><p class="lead">先保留原话，确定安排后再加入待办。</p>${data.captures.map(i => `<article class="card capture-card" data-motion-key="capture-${esc(i.id)}"><div class="capture-top"><span>${esc(i.source)}</span><span>${esc(i.at)}</span></div><p>${esc(i.text)}</p><div class="capture-actions"><button data-action="triage" data-id="${esc(i.id)}">整理为任务 ${icon('arrow',12)}</button><button data-action="discard-capture" data-id="${esc(i.id)}">移除</button></div></article>`).join('') || empty('收集箱已经理清。随时记下下一件事。')}
    <button class="full-btn outline-btn" style="margin-top:17px" data-action="capture">${icon('plus',16)} 记下一件事</button><p class="lead" style="margin-top:16px">一段交代有多件事？整理时可以拆分，原始来源随每项保留。</p><button class="quiet-button" data-action="capture-confirmation-preview">预览助理整理确认卡片</button>`;
}
function risksPage() {
  const all = risks(), list = all.filter(r => riskFilter === 'all' || r.types.includes(riskFilter));
  return `<h3 class="page-title">风险雷达</h3><p class="lead">每个提醒都有具体依据，点开就能处理。</p><div class="risk-intro"><strong>${all.length}</strong><div><p>项提醒值得留意</p><span>包含任务与项目，同一事项合并多种原因</span></div></div><div class="filter">${Object.entries(riskLabels).map(([k,l]) => `<button data-risk-filter="${k}" class="${riskFilter===k ? 'active' : ''}">${l} ${all.filter(r => k === 'all' || r.types.includes(k)).length}</button>`).join('')}</div>
    ${list.map(r => `<article class="card risk-card" data-motion-key="risk-${r.kind}-${esc(r.id)}"><div>${r.types.map(k => `<span class="badge ${['overdue','blocked'].includes(k) ? 'danger' : 'warn'}" style="margin-right:5px">${riskLabels[k]}</span>`).join('')}<span class="risk-kind">${r.kind === 'project' ? '项目' : '任务'}</span></div><h3>${esc(r.title)}</h3><p>${esc(r.description)}</p><div class="risk-actions">${r.kind === 'task' && data.tasks.find(t => t.id === r.id)?.status === 'waiting' ? `<button class="followup-action" data-action="quick-followup" data-task-id="${esc(r.id)}">安排跟进 ${icon('calendar',12)}</button>` : ''}<button data-action="${r.kind === 'project' ? 'project' : 'edit'}" data-id="${esc(r.id)}">${r.main === 'waiting' ? '编辑事项' : r.main === 'blocked' ? '处理阻塞' : '调整安排'} ${icon('arrow',12)}</button></div></article>`).join('') || empty('这个分类目前没有风险。')}`;
}
function weekRange() {
  const start = dateAdd('2026-09-28', weekOffset * 7), end = dateAdd(start,6);
  const label = `${Number(start.slice(5,7))} 月 ${Number(start.slice(8))} 日—${Number(end.slice(5,7))} 月 ${Number(end.slice(8))} 日`;
  return {start,end,nextStart:dateAdd(start,7),nextEnd:dateAdd(end,7),label};
}
function weekRecords() {
  const range = weekRange(), events = new Map();
  data.events.filter(e => (!e.kind || e.kind === 'completed') && e.at >= range.start && e.at <= range.end).forEach(e => events.set(e.taskId,e));
  return [...events.values()].sort((a,b) => b.at.localeCompare(a.at));
}
const followupMethods = {phone:'电话',message:'消息',email:'邮件',meeting:'面谈',other:'其他'};
const followupMethodLabel = e => e.method === 'other' && e.methodDetail ? '其他 · '+e.methodDetail : followupMethods[e.method];
const followupPlanLabel = e => e.followup ? '下次跟进 '+e.followup : e.previousFollowup ? '清除原跟进日期' : '跟进对象调整，未设置日期';
function weekFollowups(kind) {
  const range = weekRange();
  return data.events.filter(e => e.kind === kind && e.at >= range.start && e.at <= range.end).sort((a,b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}
function followupHistoryText() {
  const recorded = weekFollowups('followup-recorded'), planned = weekFollowups('followup-planned');
  return `本周跟进（已发生，手动补记）\n${recorded.map(e => `· ${e.at} ${e.title} · ${e.waitingFor || '未填写对象'} · ${followupMethodLabel(e)}：${e.note}${e.recordedOn !== e.at ? '（补记于 '+e.recordedOn+'）' : ''}`).join('\n') || '暂无已发生的跟进记录。'}\n\n本周调整的跟进安排（未表示已联系）\n${planned.map(e => `· ${e.at} ${e.title}：${followupPlanLabel(e)} · ${e.waitingFor || '未填写对象'}`).join('\n') || '暂无跟进安排变更。'}`;
}
function followupHistoryPage() {
  const recorded = weekFollowups('followup-recorded'), planned = weekFollowups('followup-planned');
  return `<div class="section-title"><h3>本周跟进</h3><span class="badge neutral">${recorded.length} 次 · 手动记录</span></div><div class="card">${recorded.map(e => `<div class="week-item" data-motion-key="followup-${esc(e.id)}">${esc(e.title)}<small>${esc(e.at)} · ${esc(e.waitingFor || '未填写对象')} · ${esc(followupMethodLabel(e))}${e.recordedOn !== e.at ? ' · 补记于 '+esc(e.recordedOn) : ''}</small><p class="followup-result">${esc(e.note)}</p></div>`).join('') || empty('暂无已发生的跟进记录。安排提醒不会算作已经联系。')}</div>${planned.length ? `<details class="followup-plans"><summary>本周调整的跟进安排 · ${planned.length} 次</summary><p class="sheet-desc">仅记录安排变更，不计入已跟进次数。</p><div class="card">${planned.map(e => `<div class="week-item" data-motion-key="plan-${esc(e.id)}">${esc(e.title)}<small>安排于 ${esc(e.at)} · ${esc(followupPlanLabel(e))}</small></div>`).join('')}</div></details>` : ''}`;
}
function weeklyText() {
  const range = weekRange(), completed = weekRecords();
  return `${weekOffset === 0 ? '本周' : '所选周'}复盘｜${range.label}\n\n本周完成记录\n${completed.map(e => '· ' + e.title + '（' + e.projectName + '）' + (data.tasks.find(t => t.id === e.taskId && active(t)) ? '，当前已重新打开' : '')).join('\n') || '暂无完成记录。'}\n\n${followupHistoryText()}\n\n项目当前状态（截至 10 月 3 日，非历史周快照）\n${data.projects.map(p => { const info = projectInfo(p); return '· ' + p.name + '：' + (info.progress === null ? '暂无进度' : info.progress + '%') + '，' + info.state + '；下一步：' + (p.next || '未填写'); }).join('\n') || '暂无项目。'}\n\n当前待处理风险\n${risks().map(r => '· ' + r.title + '：' + r.description).join('\n') || '暂无风险。'}\n\n${weekOffset === 0 ? '下周已有安排' : '所选周后一周：当前保留的安排'}\n${data.tasks.filter(t => active(t) && t.due >= range.nextStart && t.due <= range.nextEnd).map(t => '· ' + t.due + ' ' + t.title).join('\n') || '暂无安排。'}`;
}
function weekPage() {
  const range = weekRange(), completed = weekRecords();
  const next = data.tasks.filter(t => active(t) && t.due >= range.nextStart && t.due <= range.nextEnd).sort((a,b) => a.due.localeCompare(b.due));
  const saved = data.reviewDrafts[range.start];
  return `<div class="week-controls"><button class="icon-button" data-action="previous-week" aria-label="上一周" ${weekOffset <= -12 ? 'disabled' : ''}>${icon('back',17)}</button><div><strong>${range.label}</strong><span>${weekOffset === 0 ? '本周进行中' : '历史完成记录 · 项目与风险为当前状态'}</span></div><button class="icon-button" data-action="next-week" aria-label="下一周" ${weekOffset === 0 ? 'disabled' : ''}>${icon('arrow',17)}</button></div>
    <section class="week-summary"><h3>${weekOffset === 0 ? '忙过的事情，都有记录。' : '回看这一周的完成记录。'}</h3><div class="week-stats"><div><strong>${completed.length}</strong><span>本周完成记录</span></div><div><strong>${new Set(completed.map(e => e.project).filter(Boolean)).size}</strong><span>涉及项目</span></div></div></section>
    <div class="section-title"><h3>本周完成</h3><span>按完成时间归属</span></div><div class="card">${completed.map(e => `<div class="week-item">${icon('check',15)} &nbsp;${esc(e.title)}<small>${esc(e.projectName)} · ${e.at.slice(5)}${data.tasks.find(t => t.id === e.taskId && active(t)) ? ' · 当前已重新打开' : ''}</small></div>`).join('') || empty('这一周没有完成记录。')}</div>
    ${followupHistoryPage()}<div class="section-title"><h3>${weekOffset === 0 ? '下周已有安排' : '所选周后一周的现存安排'}</h3><span>${next.length} 项</span></div><div class="card">${next.map(taskRow).join('') || empty('这个时间范围还没有安排。')}</div>
    <div class="section-title"><h3>复盘草稿</h3>${saved ? '<span>已保存编辑</span>' : ''}</div><p class="lead">汇总真实记录，编辑后保留在本机。当前进展与历史完成分开呈现。</p><button class="full-btn" data-action="review">${saved ? '继续编辑复盘草稿' : '查看复盘草稿'} ${icon('arrow',14)}</button>`;
}
function assistantPage() {
  const overdueCount = data.tasks.filter(t => active(t) && overdue(t)).length;
  return `<div class="entry-heading"><h3>你的生活助理</h3><p>交代事情，也可以直接查看安排。</p></div><article class="card assistant-entry"><img class="entry-avatar" src="../../src/assets/secretary/balanced-female.webp" alt="生活助理"><div><span class="eyebrow">VIRTUGENE ASSISTANT</span><h3>生活助理</h3><p>今天 ${data.tasks.filter(t => active(t) && t.due === today).length} 项待办 · ${overdueCount} 项延期</p></div><div class="entry-actions"><button class="full-btn outline-btn" data-action="chat-preview">和助理聊聊</button><button class="full-btn" data-action="open-workbench">打开行动舱</button></div></article><div class="entry-description"><h3>安排和对话，各有入口。</h3><p>行动舱集中查看任务、项目和风险。继续和助理聊天时，也可以随时回来看安排。</p></div><div class="theme-actions"><button data-action="toggle-theme">切换明暗主题</button><button data-action="data-panel">数据与备份</button></div><label class="demo-clock">预览时间<input id="demo-time" aria-label="预览时间" type="time" value="${demoTime}"><span>日期固定为 10 月 3 日</span></label><div class="demo-actions"><button class="quiet-button" data-action="reset-demo">重置演示数据</button><button class="quiet-button" data-action="blank-demo">查看空白状态</button></div>`;
}
const notes = {
  today:['先看重点，再处理细节。','压紧重点区，让首屏同时露出三件重点与后续安排。统计数字可直接切换任务分组。','少填表，快安排','日期有快捷选择，等对方才展开跟进字段，补充说明按需打开。'],
  projects:['有进度，也有清楚的收尾。','按名称或下一步搜索项目；无任务时显示暂无进度。结束项目前列出所有剩余待办。','剩余事项不会消失','可保留为独立事项、迁移到另一项目或取消；确认前不修改任何记录。'],
  inbox:['一段交代，可以是几件事。','手动拆分后核对每一项，日期不明确就留空。每项都保留完整原话与来源。','整理仍由你确认','此原型演示手动整理，尚未调用模型解析。'],
  risks:['每个提醒都有处理入口。','延期、三天内截止、明确阻塞和到期跟进分别解释。任务与项目标明类型，避免误读总数。','遵循约定的跟进日','设置了未来跟进日期时，不因等待时间较长提前告警。'],
  week:['完成记录和草稿，都留得住。','可以切换周次，重新打开任务不抹去发生过的完成记录。你的编辑独立保存。','区分历史和当前','历史周展示完成事件，项目和风险明确注明是当前状态。重新生成前会提示覆盖编辑。']
};
function render(scrollTop = true) {
  const workspace = mode === 'workbench';
  document.querySelector('.statusbar b').textContent = demoTime;
  document.querySelector('.tabs').hidden = !workspace;
  document.querySelector('.composer').hidden = !workspace;
  document.getElementById('add').hidden = !workspace;
  document.getElementById('back').hidden = !workspace;
  document.getElementById('page-heading').innerHTML = `${workspace ? '行动舱' : '消息'}<span class="demo-chip">示例数据</span>`;
  document.getElementById('head-label').textContent = workspace ? '生活助理 · 工作空间' : '生活助理 · 入口预览';
  WorkbenchMotion.tabs(document.querySelector('.tabs'), Object.entries(names).map(([k,l]) => `<button role="tab" id="tab-${k}" tabindex="${k===page ? 0 : -1}" aria-controls="content" aria-selected="${k===page}" data-nav="${k}">${l}${k==='inbox' && data.captures.length ? ' <span class="tab-count">'+data.captures.length+'</span>' : ''}</button>`).join(''), Object.keys(names).indexOf(page));
  const el = document.getElementById('content');
  if (workspace) { el.setAttribute('role','tabpanel'); el.setAttribute('aria-labelledby','tab-'+page); }
  else { el.setAttribute('role','region'); el.removeAttribute('aria-labelledby'); el.setAttribute('aria-label','生活助理入口'); }
  WorkbenchMotion.page(el, `<div class="cabin-page page-enter">${workspace ? ({today:todayPage,projects:projectsPage,inbox:inboxPage,risks:risksPage,week:weekPage})[page]() : assistantPage()}</div>`, workspace ? page : 'assistant', scrollTop);
  const n = workspace ? notes[page] : ['从熟悉的助理卡片进入。','聊天与查看行动舱并列，不需要在多个一级入口之间找功能。','保留当前页面','返回行动舱时保留刚才选择的页签和筛选。'];
  document.getElementById('notes').innerHTML = `<h3>${n[0]}</h3><p>${n[1]}</p><div class="note"><strong>${n[2]}</strong><p>${n[3]}</p></div>`;
}
function sheet(title, body) {
  clearTimeout(toastTimer); document.getElementById('toast').innerHTML = ''; undoAction = null;
  if (!document.querySelector('.sheet')) returnFocus = document.activeElement;
  WorkbenchMotion.sheet(document.getElementById('overlay'), `<div class="sheet-wrap"><section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1"><div class="handle" aria-hidden="true"></div><div class="sheet-heading"><h3>${esc(title)}</h3><button data-action="close" aria-label="关闭">${icon('close')}</button></div>${body}</section></div>`);
  for (const el of document.querySelector('.phone').children) if (!['overlay','toast'].includes(el.id)) el.inert = true;
  document.querySelector('.sheet').focus({preventScroll:true});
}
function close() {
  const returnToCenter = taskEditorReturn && !!document.getElementById('task-form');
  taskEditorReturn = false;
  WorkbenchMotion.hideSheet(document.getElementById('overlay'));
  for (const el of document.querySelector('.phone').children) el.inert = false;
  if (returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
  else document.querySelector('.tabs [aria-selected="true"]')?.focus({preventScroll:true});
  if (returnToCenter) taskCenter(true);
}
const projectOptions = (selected, exclude) => `<option value="">独立事项</option>${data.projects.filter(p => p.id !== exclude && (!p.completed || p.id === selected)).map(p => `<option value="${esc(p.id)}" ${selected===p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
function editTask(id, captureId) {
  taskEditorReturn = !!document.querySelector('.task-center');
  if (taskEditorReturn) { centerScroll = document.getElementById('task-center-results').scrollTop; centerFocusId = id || null; }
  const capture = data.captures.find(i => i.id === captureId);
  const t = data.tasks.find(t => t.id === id) || {title:capture?.text || '',due:'',time:'',priority:'normal',status:'todo',project:'',note:''};
  sheet(id ? '调整这件事' : capture ? '整理为任务' : '添加任务', `${capture ? `<div class="source-preview"><span>原始交代</span><p>${esc(capture.text)}</p></div><button class="quiet-button" data-action="split-capture" data-id="${esc(capture.id)}">一段话有多件事？拆成多个任务 ${icon('arrow',12)}</button>` : ''}
    <form id="task-form" data-id="${id || ''}" data-capture="${captureId || ''}"><label>事项名称<input name="title" required maxlength="120" value="${esc(t.title)}"></label><label>所属项目<select name="project">${projectOptions(t.project)}</select></label>${data.projects.find(p => p.id === t.project)?.completed ? '<p class="waiting-hint">所属项目已收尾，将此任务改为未完成时，会同时重新打开项目。</p>' : ''}
    <div class="two"><label>截止日期<input name="due" type="date" value="${esc(t.due || '')}"></label><label>截止时间<input name="time" type="time" value="${esc(t.time || '')}"></label></div>
    <div class="quick-dates" aria-label="快捷截止日期"><button type="button" data-date="${today}">今天</button><button type="button" data-date="${dateAdd(today,1)}">明天</button><button type="button" data-date="2026-10-05">周一</button><button type="button" data-date="">暂不设日期</button></div>
    <div class="two"><label>优先级<select name="priority">${Object.entries(priorities).map(([k,l]) => `<option value="${k}" ${t.priority===k ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label>任务状态<select name="status">${Object.entries(statuses).map(([k,l]) => `<option value="${k}" ${t.status===k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div id="waiting-fields" ${t.status !== 'waiting' ? 'hidden' : ''}><div class="waiting-hint">跟进日到了才提醒；留空时，等待满 3 天提示。</div><div class="two"><label>等待谁反馈<input name="waitingFor" maxlength="80" value="${esc(t.waitingFor)}" placeholder="可选"></label><label>跟进日期<input name="followup" type="date" value="${esc(t.followup || '')}"></label></div></div>
    ${id && active(t) ? `<button type="button" class="quiet-button" data-action="record-followup" data-task-id="${esc(id)}">补记已跟进 ${icon('clock',14)}</button>` : ''}<label class="focus-toggle"><input name="focus" type="checkbox" ${isFocus(t) ? 'checked' : ''}><span>标记为今日重点<small>仅今天有效，仍遵循截止优先排序</small></span></label>
    <details class="extra-fields" ${t.status === 'blocked' ? 'open' : ''}><summary>备注与来源${t.note || t.sourceText ? ' · 有补充内容' : ''}</summary><label>备注 / 阻塞原因<textarea name="note" maxlength="1000">${esc(t.note)}</textarea></label>${t.sourceText ? `<div class="source-preview"><span>${esc(t.source || '原始交代')}</span><p>${esc(t.sourceText)}</p></div>` : ''}</details>
    <div class="sticky-actions"><button class="full-btn" type="submit">${id ? '保存调整' : '加入待办'}</button>${id ? `<button type="button" class="danger-link" data-action="delete" data-id="${esc(id)}">删除这件事</button>` : ''}</div></form>`);
}
function showProject(id) {
  const p = data.projects.find(p => p.id === id); if (!p) return;
  const info = projectInfo(p);
  sheet(p.name, `<p class="sheet-desc">${esc(p.description)}<br>${esc(p.start || '未定开始日期')}—${esc(p.due || '未定截止日期')} · ${priorities[p.priority]}优先级</p>
    <div class="project-meta"><span>${info.progress === null ? '暂无进度' : info.progress + '% · ' + info.done + '/' + info.tasks.length + ' 项完成'}</span><span>${info.state}</span></div>${info.progress !== null ? `<div class="progress"><i style="transform:scaleX(${info.progress / 100})"></i></div>` : ''}
    <div class="next"><span>下一步动作</span>${esc(p.completed ? '项目已收尾，可以回看完成记录。' : p.next || '尚未填写')}</div><div class="section-title"><h3>项目任务</h3></div><div class="card">${info.tasks.map(taskRow).join('') || empty('项目还没有任务。')}</div>
    ${data.tasks.some(t => t.project === id && t.status === 'cancelled') ? `<details class="extra-fields cancelled-records"><summary>已取消事项 · ${data.tasks.filter(t => t.project === id && t.status === 'cancelled').length} 项</summary><p class="sheet-desc">保留记录，不计入进度。点开可查看或修改状态；恢复后会重新打开项目。</p><div class="card">${data.tasks.filter(t => t.project === id && t.status === 'cancelled').map(t => `<div class="week-item"><button class="task-title" data-action="edit" data-id="${esc(t.id)}">${esc(t.title)}</button><small>已取消 · 原定 ${esc(dateLabel(t))}</small></div>`).join('')}</div></details>` : ''}
    ${p.note ? `<p class="sheet-desc" style="margin-top:15px">备注：${esc(p.note)}</p>` : ''}<div class="sheet-actions"><button class="full-btn outline-btn" data-action="edit-project" data-id="${esc(id)}">编辑项目</button><button class="full-btn" data-action="${p.completed ? 'reopen-project' : 'project-task'}" data-id="${esc(id)}">${p.completed ? '重新打开项目' : '添加任务'}</button></div>`);
}
function editProject(id, draft) {
  const p = draft || data.projects.find(p => p.id === id) || {name:'',description:'',start:today,due:'',priority:'normal',next:'',note:'',blocked:false,completed:false};
  const blockedTasks = data.tasks.filter(t => t.project === p.id && active(t) && t.status === 'blocked').length;
  sheet(id ? '编辑项目' : '新建项目', `<form id="project-form" data-id="${id || ''}"><label>项目名称<input name="name" required maxlength="60" value="${esc(p.name)}"></label><label>项目说明<textarea name="description" maxlength="1000">${esc(p.description)}</textarea></label>
    <div class="two"><label>开始日期<input name="start" type="date" value="${esc(p.start || '')}"></label><label>截止日期<input name="due" type="date" value="${esc(p.due || '')}"></label></div><div class="two"><label>优先级<select name="priority">${Object.entries(priorities).map(([k,l]) => `<option value="${k}" ${p.priority===k ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label>项目状态<select name="state"><option value="active">正常推进</option><option value="blocked" ${p.blocked && !p.completed ? 'selected' : ''}>当前阻塞</option><option value="completed" ${p.completed ? 'selected' : ''}>确认已完成</option></select></label></div>
    ${blockedTasks ? `<p class="waiting-hint">还有 ${blockedTasks} 项任务处于阻塞。只修改项目标记不会解除这些任务的阻塞；处理任务后，项目状态同步更新。</p>` : ''}<label>下一步动作<input name="next" maxlength="160" value="${esc(p.next)}"></label><details class="extra-fields"><summary>项目备注</summary><label>备注<textarea name="note" maxlength="1000">${esc(p.note)}</textarea></label></details><p class="sheet-desc">进度按关联任务计算。确认项目完成时，会先处理剩余待办。</p><div class="sticky-actions"><button class="full-btn" type="submit">保存项目</button></div></form>`);
}
function finishProject(p) {
  const remaining = data.tasks.filter(t => t.project === p.id && active(t));
  if (!remaining.length) return commitProject(p);
  pendingProject = p;
  sheet('项目收尾', `<p class="sheet-desc">“${esc(p.name)}”还有 ${remaining.length} 项待办。选择它们的去向，再确认完成项目。</p><div class="card remaining-list">${remaining.map(t => `<div class="week-item">${esc(t.title)}<small>${statuses[t.status]} · ${esc(dateLabel(t))}</small></div>`).join('')}</div>
    <form id="finish-project-form"><label class="choice"><input type="radio" name="resolution" value="detach" checked><span>保留为独立事项<small>继续出现在今日和风险中，截止日期不变</small></span></label><label class="choice"><input type="radio" name="resolution" value="move" ${data.projects.some(q => q.id !== p.id && !q.completed) ? '' : 'disabled'}><span>迁移到另一个项目<small>保留日期、状态和来源</small></span></label><label id="move-project-field" hidden>迁移至<select name="target">${data.projects.filter(q => q.id !== p.id && !q.completed).map(q => `<option value="${esc(q.id)}">${esc(q.name)}</option>`).join('')}</select></label><label class="choice"><input type="radio" name="resolution" value="cancel"><span>取消剩余待办<small>保留记录，不计入进度、风险与已完成成果</small></span></label><div class="sheet-actions sticky-actions"><button type="button" class="full-btn outline-btn" data-action="return-project-edit">返回编辑</button><button type="submit" class="full-btn">确认收尾</button></div></form>`);
}
function commitProject(p, resolution, target) {
  const saved = change(p.completed ? '项目已收尾，剩余事项已按你的选择安排。' : '项目已保存。', () => {
    if (resolution) data.tasks.filter(t => t.project === p.id && active(t)).forEach(t => {
      if (resolution === 'cancel') { t.status = 'cancelled'; t.cancelledAt = today; }
      else t.project = resolution === 'move' ? target : '';
    });
    const existing = data.projects.find(q => q.id === p.id);
    if (existing) Object.assign(existing,p); else data.projects.push(p);
  });
  if (saved) { close(); mode = 'workbench'; page = 'projects'; projectFilter = p.completed ? 'done' : 'active'; search = ''; render(); pendingProject = null; }
}
function splitCapture(id) {
  const capture = data.captures.find(i => i.id === id); if (!capture) return;
  sheet('拆成多个任务', `<div class="source-preview"><span>原始交代 · ${esc(capture.source)}</span><p>${esc(capture.text)}</p></div><p class="sheet-desc">先写清每件要做的事，一行一个；日期和项目不确定时留空。此处为手动整理。</p>
    <form id="split-form" data-id="${esc(id)}"><label>任务清单<textarea name="titles" required maxlength="1500" placeholder="补充客户案例\n核对演示材料中的数据" style="min-height:130px"></textarea></label><div class="two"><label>共同所属项目<select name="project">${projectOptions('')}</select></label><label>共同截止日期<input name="due" type="date"></label></div><div id="split-preview" class="split-preview" aria-live="polite">确认后逐项加入，可继续分别调整。</div><div class="sticky-actions"><button class="full-btn" type="submit">确认加入待办</button></div></form>`);
}
function captureSheet() {
  sheet('先记下一件事', `<p class="sheet-desc">把交代的原话、会后事项或临时想法放在这里，之后再整理。</p><form id="capture-form"><label>原始交代<textarea name="text" required maxlength="2000" placeholder="例如：周一评审前，把客户案例补到材料里…"></textarea></label><label>信息来源<select name="source"><option>临时速记</option><option>微信交代 · 手动粘贴</option><option>会议记录</option><option>同事协作</option></select></label><button class="full-btn" type="submit">放入收集箱</button></form><p class="sheet-desc" style="margin:13px 0 0">此设计稿演示手动收集；自然语言整理将在正式开发时接入助理，并显示确认卡片。</p>`);
}
function reviewSheet() {
  const range = weekRange(), generated = weeklyText(), saved = data.reviewDrafts[range.start];
  sheet('复盘草稿', `<p class="sheet-desc">${range.label} · 编辑会保留在本机示例数据中。${saved && saved.source !== generated ? '<br><span class="red">记录已有变化，已保留你的编辑。可选择重新生成。</span>' : ''}</p><textarea id="review-text" data-week="${range.start}" data-source="${esc(saved?.source || generated)}" aria-label="复盘草稿" style="height:330px;font-size:13px;line-height:1.9">${esc(saved?.text ?? generated)}</textarea><p class="draft-status" aria-live="polite">${saved ? '已恢复上次编辑' : '基于当前示例记录整理'}</p><div class="sheet-actions"><button class="full-btn outline-btn" data-action="regenerate-review">重新生成</button><button class="full-btn" data-action="copy-review">复制草稿</button></div>`);
}
function updateCompletion(t, status) {
  if (!done(t) && status === 'completed') {
    t.completedAt = today; data.events.push(completionEvent(t));
  } else if (status !== 'completed') delete t.completedAt;
  if (status === 'cancelled') t.cancelledAt = today; else delete t.cancelledAt;
  t.status = status;
}
function resetDemo(blank = false) {
  storageIssue = null;
  try { lastSavedRaw = localStorage.getItem(key); } catch {}
  const saved = change(blank ? '已切换为空白示例，可从速记或新项目开始。' : '演示数据已重置。', () => {
    data = structuredClone(seed); data.events = data.tasks.filter(done).map(completionEvent);
    if (blank) { data.projects = []; data.tasks = []; data.captures = []; data.events = []; }
  });
  if (saved) { taskEditorReturn = false; close(); mode = 'workbench'; page = 'today'; taskFilter = 'due'; projectFilter = 'active'; riskFilter = 'all'; weekOffset = 0; search = ''; demoTime = '09:41'; taskView.status = 'active'; taskView.query = ''; taskView.project = 'all'; taskView.select = false; taskView.limit = 100; taskView.ids.clear(); centerScroll = 0; centerFocusId = null; render(); }
}
document.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const a = b.dataset.action, id = b.dataset.id;
  if (b.dataset.nav) { mode = 'workbench'; page = b.dataset.nav; close(); render(); return; }
  if (b.dataset.taskFilter || b.dataset.statFilter) {
    taskFilter = b.dataset.taskFilter || b.dataset.statFilter; render(false);
    if (b.dataset.statFilter) document.getElementById('task-groups').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    return;
  }
  if (b.dataset.riskFilter) { riskFilter = b.dataset.riskFilter; render(false); return; }
  if (b.dataset.projectFilter) { projectFilter = b.dataset.projectFilter; render(false); return; }
  if ('date' in b.dataset) { document.querySelector('#task-form [name="due"]').value = b.dataset.date; if (!b.dataset.date) document.querySelector('#task-form [name="time"]').value = ''; return; }
  if (a === 'close') close();
  if (a === 'undo' && undoAction) { const action = undoAction; if (action()) toast('已撤销这次修改。'); }
  if (a === 'complete') {
    const t = data.tasks.find(t => t.id === id); if (!t) return;
    if (done(t) && data.projects.find(p => p.id === t.project)?.completed) {
      sheet('重新打开任务', `<p class="sheet-desc">这个任务所属的项目已经收尾。恢复“${esc(t.title)}”时，会同时重新打开项目，继续保留历史完成记录。</p><div class="sheet-actions"><button class="full-btn outline-btn" data-action="close">保留已完成</button><button class="full-btn" data-action="restore-project-task" data-id="${esc(id)}">恢复任务与项目</button></div>`);
      return;
    }
    const project = document.querySelector('.sheet')?.getAttribute('aria-label') === projectName(t.project) ? t.project : null;
    const status = done(t) ? 'todo' : 'completed';
    if (change((status === 'completed' ? '已完成：' : '已重新打开：') + t.title, () => updateCompletion(t,status))) {
      if (project) { const undo = undoAction; showProject(project); toast((status === 'completed' ? '已完成：' : '已重新打开：') + t.title, () => { const saved = undo(); if (saved) showProject(project); return saved; }); }
      if (document.querySelector('.task-center')) refreshTaskCenter();
    }
  }
  if (a === 'edit') editTask(id);
  if (a === 'triage') editTask(null,id);
  if (a === 'split-capture') splitCapture(id);
  if (a === 'project') showProject(id);
  if (a === 'edit-project') editProject(id);
  if (a === 'new-project') editProject();
  if (a === 'return-project-edit') editProject(pendingProject.id,pendingProject);
  if (a === 'project-task') { editTask(); document.querySelector('[name="project"]').value = id; }
  if (a === 'reopen-project') { close(); change('项目已重新打开，取消的任务仍保留为已取消。', () => { data.projects.find(p => p.id === id).completed = false; }); }
  if (a === 'restore-project-task') restoreClosedProjectTask(id);
  if (a === 'capture') captureSheet();
  if (a === 'carry-focus') carryFocusSheet();
  if (a === 'delete') sheet('删除这件事', `<p class="sheet-desc">“${esc(data.tasks.find(t => t.id === id)?.title)}”会从任务列表移除。历史完成记录保留，删除后可以撤销。</p><div class="sheet-actions"><button class="full-btn outline-btn" data-action="close">保留</button><button class="full-btn" data-action="confirm-delete" data-id="${esc(id)}">确认删除</button></div>`);
  if (a === 'confirm-delete') { close(); change('已删除示例事项。', () => { data.tasks = data.tasks.filter(t => t.id !== id); }); }
  if (a === 'discard-capture') change('已从收集箱移除。', () => { data.captures = data.captures.filter(i => i.id !== id); });
  if (a === 'clear-search') { search = ''; const input = document.getElementById('project-search'); input.value = ''; document.getElementById('project-results').innerHTML = projectResults(); input.focus(); }
  if (a === 'previous-week' || a === 'next-week') { weekOffset += a === 'previous-week' ? -1 : 1; render(false); }
  if (a === 'review') reviewSheet();
  if (a === 'regenerate-review') {
    const range = weekRange();
    if (data.reviewDrafts[range.start]) sheet('重新生成复盘', `<p class="sheet-desc">这会覆盖 ${range.label} 已保存的编辑。确认后按最新示例记录整理。</p><div class="sheet-actions"><button class="full-btn outline-btn" data-action="review">保留编辑</button><button class="full-btn" data-action="confirm-regenerate">重新生成</button></div>`);
    else reviewSheet();
  }
  if (a === 'confirm-regenerate') { if (change('已按当前记录重新整理。', () => { delete data.reviewDrafts[weekRange().start]; })) reviewSheet(); }
  if (a === 'copy-review') {
    const text = document.getElementById('review-text').value;
    try { if (!navigator.clipboard) throw new Error('clipboard unavailable'); await navigator.clipboard.writeText(text); toast('已复制复盘草稿。'); }
    catch { document.getElementById('review-text').focus(); document.getElementById('review-text').select(); toast('自动复制未成功，已选中草稿，可手动复制。'); }
  }
  if (a === 'assistant-entry') { close(); mode = 'assistant'; render(); }
  if (a === 'open-workbench') { mode = 'workbench'; render(); }
  if (a === 'chat-preview') sheet('和助理聊聊', '<p class="sheet-desc">正式应用中，这个入口继续现有助理对话。本设计稿演示入口关系；你可以打开行动舱查看安排。</p><button class="full-btn" data-nav="today">打开行动舱</button>');
  if (a === 'reset-demo') resetDemo();
  if (a === 'blank-demo') resetDemo(true);
  if (a === 'ranking') sheet('今日重点怎么选', `<p class="sheet-desc">优先展示可推进的任务，等待和阻塞事项在风险页处理。</p><div class="card">${['已延期的重要 / 紧急任务','今天截止的重要 / 紧急任务','今天截止的普通任务','你标记的今日重点（仅今天有效）','其他任务按截止日期排序'].map((t,i) => `<div class="week-item">${i+1}. ${t}</div>`).join('')}</div><p class="sheet-desc" style="margin:16px 0 0">同档按截止日期、时间与稳定顺序排序，不足三项展示实际数量。</p>`);
});
document.addEventListener('change', e => {
  if (e.target.matches('#task-form [name="status"]')) {
    document.getElementById('waiting-fields').hidden = e.target.value !== 'waiting';
    if (e.target.value === 'blocked') document.querySelector('.extra-fields').open = true;
  }
  if (e.target.matches('#finish-project-form [name="resolution"]')) document.getElementById('move-project-field').hidden = e.target.value !== 'move';
});
document.addEventListener('input', e => {
  if (e.target.id === 'project-search') { search = e.target.value; document.getElementById('project-results').innerHTML = projectResults(); }
  if (e.target.matches('#split-form [name="titles"]')) {
    const titles = e.target.value.split('\n').map(t => t.trim()).filter(Boolean);
    document.getElementById('split-preview').innerHTML = `<strong>准备加入 ${titles.length} 项</strong>${titles.map((t,i) => `<div>${i+1}. ${esc(t)}</div>`).join('')}`;
  }
  if (e.target.id === 'review-text') {
    const previous = data.reviewDrafts[e.target.dataset.week];
    data.reviewDrafts[e.target.dataset.week] = {text:e.target.value,source:e.target.dataset.source};
    const saved = save();
    if (!saved) { if (previous) data.reviewDrafts[e.target.dataset.week] = previous; else delete data.reviewDrafts[e.target.dataset.week]; }
    document.querySelector('.draft-status').textContent = saved ? '已保存编辑 · 本机示例数据' : '未能保存 · 请复制当前编辑或重试';
  }
});
document.addEventListener('submit', e => {
  e.preventDefault(); const f = e.target, values = Object.fromEntries(new FormData(f));
  if (f.id === 'task-form') {
    if (!values.title.trim()) return;
    const existing = data.tasks.find(t => t.id === f.dataset.id), capture = data.captures.find(i => i.id === f.dataset.capture);
    if (values.status === 'waiting' && values.followup && values.followup < today && values.followup !== existing?.followup) { toast('下次跟进请选择今天或之后；已经发生的联系请使用补记已跟进。'); return; }
    const saved = change(existing ? '事项已调整。' : '已加入待办。', () => {
      if (existing && values.status === 'waiting') recordFollowupPlan(existing,values.followup,values.waitingFor.trim());
      const task = {...(existing || {}),...values,createdDate:existing ? existing.createdDate : today,id:existing?.id || 't-'+crypto.randomUUID(),title:values.title.trim(),time:values.due ? values.time : '',focusDate:values.focus === 'on' ? today : existing?.focusDate === today ? '' : existing?.focusDate || '',waitingSince:values.status === 'waiting' ? (existing?.status === 'waiting' ? existing.waitingSince || today : today) : undefined};
      delete task.focus;
      if (!existing && values.status === 'waiting' && values.followup) recordFollowupPlan({...task,followup:'',waitingFor:''},values.followup,values.waitingFor.trim());
      if (capture) { task.sourceText = capture.text; task.source = capture.source; data.captures = data.captures.filter(i => i.id !== capture.id); }
      // Compare against the previous state before creating a completion event.
      task.status = existing?.status || 'todo'; updateCompletion(task,values.status);
      if (existing) data.tasks[data.tasks.findIndex(t => t.id === existing.id)] = task; else data.tasks.push(task);
      if (active(task)) { const p = data.projects.find(p => p.id === task.project); if (p?.completed) p.completed = false; }
    });
    if (saved) {
      const undo = undoAction, returnToCenter = taskEditorReturn; taskEditorReturn = false; close();
      if (returnToCenter) { taskCenter(true); toast(existing ? '事项已调整。' : '已加入待办。',undo); }
    }
  }
  if (f.id === 'project-form') {
    if (!values.name.trim()) return;
    if (values.start && values.due && values.start > values.due) { toast('截止日期不能早于开始日期。'); return; }
    const p = {...values,id:f.dataset.id || 'p-'+crypto.randomUUID(),name:values.name.trim(),blocked:values.state === 'blocked',completed:values.state === 'completed'};
    if (p.completed) finishProject(p); else commitProject(p);
  }
  if (f.id === 'finish-project-form') {
    if (!pendingProject) return;
    if (values.resolution === 'move' && !data.projects.some(p => p.id === values.target && p.id !== pendingProject.id && !p.completed)) { toast('请选择一个进行中的目标项目。'); return; }
    commitProject(pendingProject,values.resolution,values.target);
  }
  if (f.id === 'split-form') {
    const capture = data.captures.find(i => i.id === f.dataset.id), titles = values.titles.split('\n').map(t => t.trim()).filter(Boolean);
    if (!capture || !titles.length) return;
    if (titles.length > 12 || titles.some(t => t.length > 120)) { toast('一次最多整理 12 项，每项标题最多 120 字。'); return; }
    const saved = change(`已加入 ${titles.length} 项，原话与来源均已保留。`, () => {
      data.tasks.push(...titles.map(title => ({id:'t-'+crypto.randomUUID(),title,createdDate:today,project:values.project,due:values.due,priority:'normal',status:'todo',sourceText:capture.text,source:capture.source})));
      data.captures = data.captures.filter(i => i.id !== capture.id);
    });
    if (saved) close();
  }
  if (f.id === 'capture-form') {
    if (!values.text.trim()) return;
    if (change('已收下，之后可以整理。', () => { data.captures.unshift({id:'i-'+crypto.randomUUID(),text:values.text.trim(),source:values.source,at:'刚刚'}); })) { close(); mode = 'workbench'; page = 'inbox'; render(); }
  }
});
document.addEventListener('keydown', e => {
  const dialog = document.querySelector('.sheet');
  if (!dialog) {
    if (e.target.matches('[role="tab"]') && ['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) {
      e.preventDefault(); const tabs = Object.keys(names), i = tabs.indexOf(page);
      page = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs.at(-1) : tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      render(); document.getElementById('tab-'+page).focus();
    }
    return;
  }
  if (e.key === 'Escape') { e.preventDefault(); close(); }
  if (e.key === 'Tab') {
    const nodes = [...dialog.querySelectorAll('button,input,textarea,select,summary,[tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
    const first = nodes[0], last = nodes.at(-1);
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { e.preventDefault(); first?.focus(); }
  }
});
document.getElementById('add').innerHTML = icon('plus',22);
document.getElementById('add').onclick = () => editTask();
document.getElementById('back').innerHTML = icon('back',20);
document.getElementById('capture').onclick = captureSheet;
document.getElementById('reset').onclick = () => resetDemo();
document.querySelector('.bottom').innerHTML = [['message','消息'],['world','世界'],['user','角色'],['user','我的']].map(([i,n],index) => `<button class="${index===0 ? 'current' : ''}" data-action="${index===0 ? 'assistant-entry' : 'app-nav'}">${icon(i,18)}<span>${n}</span></button>`).join('');
document.querySelector('.bottom').addEventListener('click', e => { if (e.target.closest('[data-action="app-nav"]')) toast('本原型展示助理行动舱；应用其他页面继续保留现有功能。'); });
render();
