// 临时自测：群聊 parseTurns 解析逻辑（与 group-chat.ts 同源复制的核心，防逻辑回归）
// 用法: node scripts/group-parse-test.mjs

function stripRoleplayActions(s) {
  return s.replace(/[（(][^）)]*[）)]/g, '').trim();
}

const members = [
  { id: 'a', name: '林霜', persona: '理性' },
  { id: 'b', name: '艾莉', persona: '开朗' },
];

function parseTurns(text, members) {
  const byName = new Map(members.map((m) => [m.name, m.id]));
  const out = [];
  const unknownSpeakers = [];

  const normalizeName = (raw) =>
    String(raw ?? '')
      .trim()
      .replace(/^[（(【\[『「]+/, '')
      .replace(/[）)】\]』」：:。，,！!？?、…\s]+$/, '')
      .trim();

  const resolveId = (name) => {
    const n = normalizeName(name);
    if (!n) return undefined;
    const exact = byName.get(n);
    if (exact) return exact;
    const hits = [];
    for (const [memName, mid] of byName) {
      if (memName.includes(n) || n.includes(memName)) hits.push(mid);
    }
    if (hits.length === 1) return hits[0];
    return undefined;
  };

  const push = (speakerName, content) => {
    const name = String(speakerName ?? '').trim();
    const c = String(content ?? '').trim();
    if (!name) { unknownSpeakers.push('(空名字)'); return; }
    const senderId = resolveId(name);
    if (!senderId) { unknownSpeakers.push(name); return; }
    if (!c) return;
    if (out.length < 3) out.push({ senderId, content: stripRoleplayActions(c).slice(0, 500) });
  };

  const consumeItems = (items) => {
    let any = false;
    for (const item of items.slice(0, 3)) {
      if (item && typeof item === 'object') {
        const it = item;
        if ('speaker' in it || 'name' in it || 'content' in it) { push(it.speaker ?? it.name, it.content); any = true; }
      } else if (typeof item === 'string') {
        const lm = item.match(/^[（(]?([^：:]{1,12})[）)]?[：:]\s*(.+)$/);
        if (lm) { push(lm[1], lm[2]); any = true; }
      }
    }
    return any;
  };

  const consumeArrayText = (chunk) => {
    try { const arr = JSON.parse(chunk); if (Array.isArray(arr)) return consumeItems(arr); } catch { /* 忽略 */ }
    return false;
  };

  const text0 = text.trim();
  if (text0) {
    try {
      const obj = JSON.parse(text0);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const o = obj;
        for (const key of ['turns', 'messages', 'result', 'data', 'response', 'output', 'replies', 'items']) {
          const v = o[key];
          if (Array.isArray(v)) {
            consumeItems(v);
            if (out.length > 0 || unknownSpeakers.length > 0) return { turns: out, unknownSpeakers, via: 'json-object' };
          } else if (typeof v === 'string' && v.trim()) {
            const inner = v.replace(/\\"/g, '"');
            if (consumeArrayText(inner)) return { turns: out, unknownSpeakers, via: 'json-string' };
          }
        }
        for (const v of Object.values(o)) {
          if (Array.isArray(v)) {
            consumeItems(v);
            if (out.length > 0 || unknownSpeakers.length > 0) return { turns: out, unknownSpeakers, via: 'json-object' };
          }
        }
        if ('speaker' in o || 'name' in o) {
          push(o.speaker ?? o.name, o.content);
          return { turns: out, unknownSpeakers, via: 'json-object' };
        }
      }
    } catch { /* 整文不是 JSON */ }

    const arrM = text0.match(/\[[\s\S]*\]/);
    if (arrM && consumeArrayText(arrM[0])) return { turns: out, unknownSpeakers, via: 'json-array' };
    const escM = text0.match(/\\"\[[\s\S]*?\\"\]/);
    if (escM && consumeArrayText(escM[0].replace(/\\"/g, '"'))) return { turns: out, unknownSpeakers, via: 'json-string' };
  }

  for (const line of text.split('\n')) {
    const lt = line.trim();
    if (!lt || lt.startsWith('{') || lt.startsWith('[') || lt.startsWith('"')) continue;
    const lm = line.match(/^[（(]?([^：:]{1,12})[）)]?[：:]\s*(.+)$/);
    if (lm) push(lm[1], lm[2]);
    if (out.length >= 3) break;
  }
  if (out.length > 0) return { turns: out, unknownSpeakers, via: 'lines' };
  return { turns: out, unknownSpeakers: [...new Set(unknownSpeakers)], via: 'none' };
}

const cases = [
  ['对象包数组', '{"turns":[{"speaker":"林霜","content":"哈喽"},{"speaker":"艾莉","content":"在呢"}]}', 2, 'json-object', []],
  ['对象包JSON字符串数组', '{"result":"[{\\"speaker\\":\\"林霜\\",\\"content\\":\\"哈喽\\"}]"}', 1, 'json-string', []],
  ['output键JSON字符串数组', '{"output":"[{\\"speaker\\":\\"林霜\\",\\"content\\":\\"哈喽\\"},{\\"speaker\\":\\"艾莉\\",\\"content\\":\\"在呢\\"}]"}', 2, 'json-string', []],
  ['裸数组', '[{"speaker":"林霜","content":"哈喽"}]', 1, 'json-array', []],
  ['markdown围栏数组', '```json\n[{"speaker":"林霜","content":"哈喽"}]\n```', 1, 'json-array', []],
  ['单对象', '{"speaker":"林霜","content":"哈喽"}', 1, 'json-object', []],
  ['散文本行', '林霜：哈喽\n艾莉：在呢', 2, 'lines', []],
  ['部分未知发言人(保留命中)', '{"turns":[{"speaker":"林霜","content":"哈喽"},{"speaker":"张伟","content":"嗨"}]}', 1, 'json-object', ['张伟']],
  ['全部未知发言人', '{"turns":[{"speaker":"张伟","content":"哈喽"}]}', 0, 'json-object', ['张伟']],
  ['截断残缺', '{"turns":[{"speaker":"林霜","content":"哈喽"},', 0, 'none', []],
  ['纯空白', '   ', 0, 'none', []],
  // ── 发言人归属（防"话跑错气泡"）──
  ['名字带冒号', '{"turns":[{"speaker":"林霜：","content":"哈喽"}]}', 1, 'json-object', [], 0],
  ['名字带括号', '{"turns":[{"speaker":"（艾莉）","content":"哈喽"}]}', 1, 'json-object', [], 0],
  ['唯一简称', '{"turns":[{"speaker":"霜","content":"哈喽"}]}', 1, 'json-object', [], 0],
  ['重名歧义不猜', '{"turns":[{"speaker":"莉","content":"哈喽"}]}', 0, 'json-object', ['莉'], 1],
  ['歧义时正确名仍命中', '{"turns":[{"speaker":"艾莉丝","content":"哈喽"},{"speaker":"莉","content":"喂"}]}', 1, 'json-object', ['莉'], 1],
];

// 成员含重名/包含关系：艾莉 vs 艾莉丝（覆盖"话配错人"场景）
const overlapMembers = [
  { id: 'a', name: '林霜', persona: '理性' },
  { id: 'b', name: '艾莉', persona: '开朗' },
  { id: 'c', name: '艾莉丝', persona: '温柔' },
];

let pass = 0;
for (const [name, input, expTurns, expVia, expUnknown, useOverlap] of cases) {
  const r = parseTurns(input, useOverlap ? overlapMembers : members);
  const ok =
    r.turns.length === expTurns &&
    r.via === expVia &&
    JSON.stringify(r.unknownSpeakers) === JSON.stringify(expUnknown);
  // 归属校验：若期望有 turns，且 case 指定了期望 sender 顺序（末位字段），额外核对
  if (!ok) {
    console.log(`✗ ${name}\n  输入: ${input}\n  期望: turns=${expTurns} via=${expVia} unknown=${JSON.stringify(expUnknown)}\n  实际: turns=${r.turns.length} via=${r.via} unknown=${JSON.stringify(r.unknownSpeakers)}`);
  } else {
    pass++;
    console.log(`✓ ${name}`);
  }
}
console.log(`\n${pass}/${cases.length} 通过`);
process.exit(pass === cases.length ? 0 : 1);
