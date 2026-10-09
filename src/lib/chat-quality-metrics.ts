import { useAuthStore } from '../store/auth-store';
import { stripRoleplayActions } from './ai/text';

export interface ChatQualitySample { at: number; rawChars: number; savedChars: number; differenceRatio: number; approximate: boolean; retries: number; captured: boolean; alert: boolean; issue?: string; streamed?: boolean; actionRemovedChars?:number; collapsedLineBreaks?:number;introducedChineseSpaces?:number }
export type QualityMode = 'private' | 'proactive' | 'group';
export interface QualityEvent { at:number;mode:QualityMode;issue?:string;retries:number;blocked:boolean;streamed:boolean;durationMs?:number;firstVisibleMs?:number }
const issues = new Set(['empty','repeat-user','generic','repeat-own','too-long','over-structured','question-barrage','voice-conflict','uninvited-staging','emotional-script','self-report-risk','user-source-risk']);
const eventKey = (owner:string) => `virtugene-chat-quality-events:${owner}`;
function events(owner:string): QualityEvent[] {
  try { const rows=JSON.parse(localStorage.getItem(eventKey(owner)) ?? '[]'); return Array.isArray(rows) ? rows.filter(e => ['private','proactive','group'].includes(e?.mode) && Number.isFinite(e.at) && Number.isFinite(e.retries)).slice(-200) : []; } catch {return [];}
}
/** Enum/numeric diagnostics only. Never persist prompts, drafts or credentials. */
export function recordQualityEvent(owner:string, event:Omit<QualityEvent,'at'>): void {
  if (!owner || useAuthStore.getState().userId !== owner || !['private','proactive','group'].includes(event.mode)) return;
  const row:QualityEvent={at:Date.now(),mode:event.mode,issue:issues.has(event.issue ?? '') ? event.issue : undefined,retries:Math.max(0,Math.min(1,event.retries || 0)),blocked:!!event.blocked,streamed:!!event.streamed,
    durationMs:Number.isFinite(event.durationMs) ? Math.max(0,event.durationMs!) : undefined,firstVisibleMs:Number.isFinite(event.firstVisibleMs)?Math.max(0,event.firstVisibleMs!):undefined};
  try {localStorage.setItem(eventKey(owner),JSON.stringify([...events(owner),row].slice(-200)));window.dispatchEvent(new Event('vg:chat-quality'));} catch { /* best effort */ }
}
const key = (owner: string) => `virtugene-chat-quality:${owner}`;
function comparable(text: string): string[] {
  try { const json = JSON.parse(text); if (Array.isArray(json?.messages)) text = json.messages.filter((s: unknown) => typeof s === 'string').join(''); } catch { /* ordinary text */ }
  return Array.from(text.replace(/-{3,}/gu, '').replace(/\s/gu, ''));
}
/** Character edits; trim unchanged ends and bound quadratic work for long replies. */
export function cleanupDifference(raw: string, saved: string): { ratio: number; approximate: boolean; rawChars: number; savedChars: number } {
  const a = comparable(raw), b = comparable(saved);
  const denominator = Math.max(a.length, b.length, 1);
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const x = a.slice(start, endA), y = b.slice(start, endB);
  let edits = 0, approximate = false;
  if (!x.length || !y.length) edits = Math.max(x.length, y.length);
  else if (x.length * y.length <= 400000) {
    let previous = Array.from({ length: y.length + 1 }, (_, i) => i);
    for (let i = 1; i <= x.length; i++) {
      const current = [i];
      for (let j = 1; j <= y.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(x[i - 1] !== y[j - 1]));
      previous = current;
    }
    edits = previous[y.length];
  } else {
    // Large cases use an explicitly labelled upper bound, not a false exact rate.
    approximate = true; edits = Math.max(x.length, y.length);
  }
  return { ratio: Math.min(1, edits / denominator), approximate, rawChars: a.length, savedChars: b.length };
}
function read(owner: string): ChatQualitySample[] {
  try { const data = JSON.parse(localStorage.getItem(key(owner)) ?? '[]'); return Array.isArray(data) ? data.filter(s => s && Number.isFinite(s.at) && Number.isFinite(s.differenceRatio) && typeof s.captured === 'boolean' && Number.isFinite(s.retries)).slice(-200) : []; } catch { return []; }
}
export function recordChatQuality(owner: string, raw: string, saved: string, retries: number, captured: boolean, quality: {issue?:string;streamed?:boolean;durationMs?:number;firstVisibleMs?:number} = {}): void {
  if (useAuthStore.getState().userId !== owner) return;
  const difference = cleanupDifference(raw, saved);
  const chineseSpaces=(s:string)=>(s.match(/\p{Script=Han}[ \t]+(?=\p{Script=Han})/gu)??[]).length;
  const sample: ChatQualitySample = { at: Date.now(), rawChars: difference.rawChars, savedChars: difference.savedChars, differenceRatio: difference.ratio, approximate: difference.approximate, retries, captured, alert: captured && difference.ratio > 0.15, ...quality,
    actionRemovedChars:captured?Math.max(0,raw.length-stripRoleplayActions(raw).length):undefined,collapsedLineBreaks:captured?(raw.match(/\r\n|[\r\n]/gu)??[]).length:undefined,introducedChineseSpaces:captured?Math.max(0,chineseSpaces(saved)-chineseSpaces(raw)):undefined};
  try { localStorage.setItem(key(owner), JSON.stringify([...read(owner), sample].slice(-200))); } catch { /* diagnostics never block chatting */ }
  recordQualityEvent(owner,{mode:'private',issue:quality.issue,retries,blocked:false,streamed:!!quality.streamed,durationMs:quality.durationMs,firstVisibleMs:quality.firstVisibleMs});
}
export function chatQualityReport() {
  const owner = useAuthStore.getState().userId;
  const samples = owner ? read(owner) : [];
  const captured = samples.filter(sample => sample.captured);
  const recentEvents=owner ? events(owner) : [];
  const byMode=Object.fromEntries((['private','proactive','group'] as QualityMode[]).map(mode => {
    const rows=recentEvents.filter(e=>e.mode===mode),timed=rows.filter(e=>e.durationMs !== undefined),visible=rows.filter(e=>e.firstVisibleMs !== undefined);
    return [mode,{checked:rows.length,retried:rows.filter(e=>e.retries>0).length,improvedAfterRetry:rows.filter(e=>e.retries>0&&!e.issue).length,unresolvedAfterRetry:rows.filter(e=>e.retries>0&&e.issue).length,unresolved:rows.filter(e=>e.issue).length,blocked:rows.filter(e=>e.blocked).length,streamedUnresolved:rows.filter(e=>e.streamed&&e.issue).length,averageDurationMs:timed.length ? timed.reduce((sum,e)=>sum+e.durationMs!,0)/timed.length : null,averageFirstVisibleMs:visible.length?visible.reduce((sum,e)=>sum+e.firstVisibleMs!,0)/visible.length:null,
      issues:Object.fromEntries([...issues].map(issue=>[issue,rows.filter(e=>e.issue===issue).length]))}];
  }));
  return { samples, events:recentEvents, byMode, turns: samples.length, measuredTurns: captured.length, alerts: captured.filter(s => s.alert).length, retryTriggers: samples.reduce((sum, s) => sum + s.retries, 0), retryRate: samples.length ? samples.filter(s => s.retries > 0).length / samples.length : 0, streamedQualityIssues:samples.filter(s => s.streamed && s.issue).length, checkedTurns:samples.filter(s => typeof s.streamed === 'boolean').length, averageDifference: captured.length ? captured.reduce((sum, s) => sum + s.differenceRatio, 0) / captured.length : null };
}
export function clearChatQuality(): void {const owner=useAuthStore.getState().userId;if(owner){localStorage.removeItem(key(owner));localStorage.removeItem(eventKey(owner));window.dispatchEvent(new Event('vg:chat-quality'));}}
if (typeof window !== 'undefined') Object.assign(window, { virtugeneChatQuality: { report: chatQualityReport, clear:clearChatQuality } });
