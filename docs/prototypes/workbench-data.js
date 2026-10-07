// Validation for isolated preview data, not the application's database schema.
const WorkbenchData = (() => {
  const record = x => !!x && typeof x === 'object' && !Array.isArray(x);
  const text = (x, max = 2000) => typeof x === 'string' && x.length <= max;
  const date = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x+'T12:00:00Z')) && new Date(x+'T12:00:00Z').toISOString().slice(0,10) === x;
  const optionalDate = x => x === undefined || x === '' || date(x);
  const optionalText = (x, max) => x === undefined || text(x,max);
  const list = (x, max) => Array.isArray(x) && x.length <= max;
  const unique = xs => xs.every(record) && new Set(xs.map(x => x.id)).size === xs.length;
  function validate(value) {
    const x = value?.format === 'virtugene-workbench-design' ? value.data : value;
    if (value?.format && (value.format !== 'virtugene-workbench-design' || ![3,4].includes(value.version))) return null;
    if (!record(x) || !list(x.tasks,5000) || !list(x.projects,500) || !list(x.captures,1000)) return null;
    const id = x => text(x,100) && /^[a-zA-Z0-9_-]+$/.test(x);
    if (!x.projects.every(p => record(p) && id(p.id) && text(p.name,60) && p.name.trim() && ['normal','important','urgent'].includes(p.priority) && optionalDate(p.start) && optionalDate(p.due) && !(p.start && p.due && p.start > p.due) && optionalText(p.description,2000) && optionalText(p.next,160) && optionalText(p.note,2000) && (p.blocked === undefined || typeof p.blocked === 'boolean') && (p.completed === undefined || typeof p.completed === 'boolean'))) return null;
    const projects = new Set(x.projects.map(p => p.id));
    if (!x.tasks.every(t => record(t) && id(t.id) && text(t.title,120) && t.title.trim() && ['todo','doing','waiting','blocked','completed','cancelled'].includes(t.status) && ['normal','important','urgent'].includes(t.priority) && (!t.project || projects.has(t.project)) && optionalDate(t.due) && (!t.time || typeof t.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time) && !!t.due) && ['createdDate','focusDate','waitingSince','followup','completedAt','cancelledAt'].every(k => optionalDate(t[k])) && (t.status !== 'completed' || date(t.completedAt)) && ['note','waitingFor','source','sourceText'].every(k => optionalText(t[k],2000)))) return null;
    if (!x.captures.every(i => record(i) && id(i.id) && text(i.text,2000) && i.text.trim() && text(i.source,100) && text(i.at,100))) return null;
    if (![x.tasks,x.projects,x.captures].every(unique)) return null;
    const createdDates = new Map(x.tasks.map(t => [t.id,t.createdDate]));
    if (x.events !== undefined && (!list(x.events,20000) || !unique(x.events) || !x.events.every(e => {
      if (!(record(e) && id(e.id) && id(e.taskId) && text(e.title,120) && optionalText(e.project,100) && text(e.projectName,100) && date(e.at))) return false;
      if (value?.format && value.version === 4 && typeof e.kind !== 'string') return false;
      const kind = e.kind ?? 'completed';
      if (!['completed','followup-planned','followup-recorded'].includes(kind)) return false;
      if (kind === 'completed') return true;
      if (!date(e.recordedOn) || e.at > e.recordedOn || !optionalText(e.waitingFor,80)) return false;
      if (kind === 'followup-planned') return e.at === e.recordedOn && typeof e.followup === 'string' && optionalDate(e.followup) && (!e.followup || e.followup >= e.at) && optionalDate(e.previousFollowup) && optionalText(e.previousWaitingFor,80);
      const createdDate = e.taskCreatedDate || createdDates.get(e.taskId);
      return ['phone','message','email','meeting','other'].includes(e.method) && text(e.note,500) && !!e.note.trim()
        && optionalDate(e.taskCreatedDate) && (!createdDate || e.at >= createdDate)
        && optionalText(e.methodDetail,40) && (!e.methodDetail || e.method === 'other' && !!e.methodDetail.trim());
    }))) return null;
    if (x.reviewDrafts !== undefined && (!record(x.reviewDrafts) || Object.keys(x.reviewDrafts).length > 500 || !Object.entries(x.reviewDrafts).every(([k,d]) => date(k) && record(d) && text(d.text,100000) && text(d.source,200000)))) return null;
    return structuredClone(x);
  }
  return {validate,date};
})();
