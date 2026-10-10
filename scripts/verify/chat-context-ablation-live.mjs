import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Diagnostic only. No production prompt, chat history or persona is updated. */
export function ablateOwnedGuidance(system, roleName, variant) {
  if (!['古月娜', '陆雪琪'].includes(roleName)) throw Error('Unsupported owned role');
  if (!['body-guidance-reduced', 'duplicate-fields-only', 'interaction-state-neutral', 'agency-framing', 'clarification-framing', 'reaction-brief','voice-style-tail','shared-joy-framing','focused-reactions'].includes(variant)) throw Error('Unknown ablation');
  if (variant === 'interaction-state-neutral') {
    if (!system.includes('[当前灵魂状态]')) throw Error('Missing interaction state');
    return system.split('\n').filter(line => !line.startsWith('本应用互动累计等阶：') && !line.startsWith('本应用互动好感指标：')).join('\n');
  }
  const voiceStart = system.lastIndexOf('[人物声音卡]');
  const voiceEnd = system.indexOf('[/人物声音卡]', voiceStart);
  if (voiceStart < 0 || voiceEnd < 0) throw Error('Missing complete voice card');
  if(variant==='focused-reactions') {
    const tail=system.slice(voiceStart,voiceEnd);
    const body=system.slice(0,voiceStart);
    const fields=/^(?:被夸反应|分歧反应|道歉修复|亲密反应|疲惫回应|庆祝反应)[：:]/u;
    const irrelevant=body.split('\n').filter(line=>fields.test(line.trim())&&!tail.includes(line.trim()));
    if(!irrelevant.length)throw Error('No inactive exact reaction fields');
    return body.split('\n').filter(line=>!irrelevant.includes(line)).join('\n')+system.slice(voiceStart);
  }
  if(variant==='shared-joy-framing') {
    const original='庆祝反应：为眼前的好消息高兴，认真认可那件事，不补一段用户此前受苦的经历。';
    const revised='庆祝反应：亲近的人愿意告诉你一件高兴的小事，你也会觉得有趣或高兴，平常地说自己的反应。';
    if(roleName!=='陆雪琪'||system.split(original).length!==3)throw Error('Expected both exact authored celebration fields');
    return system.replaceAll(original,revised);
  }
  if(variant==='voice-style-tail') {
    const lines=system.slice(0,voiceStart).split('\n').map(line=>line.trim())
      .filter(line=>/^(?:[-*•]\s*)?(?:说话风格|表达习惯|语言风格)[：:]/u.test(line));
    if(!lines.length||system.slice(voiceStart,voiceEnd).includes('人物说话习惯'))throw Error('Expected omitted authored speaking style');
    return system.slice(0,voiceEnd)+'人物说话习惯（沿用原人设）：'+lines[0].slice(0,180)+'\n'+system.slice(voiceEnd);
  }
  if (variant === 'reaction-brief') {
    const original='轻松交流，接这件小事的趣味或说自己的感受，表达偏好、只回反应也可以；普通分享不是让你检查生活是否正确，不自动补处理办法。用户只说当下感受时，回应这一刻就够了，不需要给出它从哪里来的解释；用户自己讲明的原因照常使用。同感可以是一句当下的态度或玩笑，不必用“我以前也这样”“我有次”开一段无来源的亲身故事。';
    const revised='普通分享不用找一个需要解决的问题。你想说的兴趣、好恶、感受或玩笑都可以直接说；有具体好奇再问。让这段话自然停下来，不为了完整而总结。';
    const paceStart=system.indexOf('[本轮交流的隐藏节奏]');
    const pace=system.slice(paceStart,voiceStart);
    if(paceStart<0||paceStart>=voiceStart||pace.split('\n').filter(line=>line===original).length!==1)throw Error('Expected exact owned casual-reaction direction missing');
    return system.slice(0,paceStart)+pace.split('\n').map(line=>line===original?revised:line).join('\n')+system.slice(voiceStart);
  }
  if (variant === 'clarification-framing') {
    const direction='用户正在更正这次交流的用意，继续原来的事，按他明确补充的用意回应。更正可以平常接下，自己的误解直接改过来；不必解释他为何这样说，也不把认可更正重复成两条确认。仍保留你自己的感受和看法。';
    const generic='用户在更正刚才的说法，接最新内容即可。更正的是自己的认识还是外部事实，以其原话为准；未说改期、取消或发生新变化，就不替事件补一段变动经过。';
    const revised='这轮是在补充交流用意，仍在聊原来的事。沿用户明确补充的范围，说你自己的反应或看法。前文确实理解偏了才更正；补充范围本身不证明你说错了。接话可以平常而直接，不需要先做一段确认。';
    const paceStart=system.indexOf('[本轮交流的隐藏节奏]');
    const pace=system.slice(paceStart,voiceStart);
    if(paceStart<0||paceStart>=voiceStart||pace.split('\n').filter(line=>line===direction).length!==1
      ||pace.split('\n').filter(line=>line===generic).length!==1)throw Error('Expected exact owned clarification directions missing');
    return system.slice(0,paceStart)+pace.split('\n').filter(line=>line!==generic).map(line=>line===direction?revised:line).join('\n')+system.slice(voiceStart);
  }
  const tail = system.slice(voiceStart, voiceEnd);
  const begin = `[VirtuGene · ${roleName}的关心]`;
  const end = `[/VirtuGene · ${roleName}的关心]`;
  const start = system.indexOf(begin), stop = system.indexOf(end, start);
  if (start < 0 || stop < 0 || stop >= voiceStart) throw Error('Missing distinct owned body block');
  if (variant === 'agency-framing') {
    // Diagnostic wording only. Leave novel facts, relationship text, user
    // messages and the outsider's pride intact. No scenario-specific example.
    if (roleName !== '古月娜') throw Error('No authored Lu Xue Qi equivalent established');
    const substitutions = [
      ['你的骄傲在自己的选择里，愿意说什么就说清楚。', '你清楚自己的好恶和选择，愿意说什么就说清楚。'],
      ['小事先注意事情的反差，骄傲落在自己的选择上。', '有趣时自然觉得好笑，认真分享时认真听。自己的意见来自内容和好恶。'],
    ];
    const transform = section => {
      for (const [from, to] of substitutions) {
        if (!section.includes(from)) throw Error('Expected complete authored guidance missing');
        section = section.replaceAll(from, to);
      }
      return section;
    };
    return system.slice(0, start) + transform(system.slice(start, stop))
      + system.slice(stop, voiceStart) + transform(tail) + system.slice(voiceEnd);
  }
  const body = system.slice(start, stop);
  const fields = /^(?:在意的事|判断习惯|亲密反应|分歧反应|疲惫回应|关心方式)[：:]/u;
  const kept = body.split('\n').filter(line => {
    if (variant === 'body-guidance-reduced') return !fields.test(line) && !line.startsWith('【日常语气】');
    // A truncated or merely similar tail field is not the complete source.
    // Preserve every non-repeated line, factual source and relationship rule.
    return !fields.test(line) || !tail.includes(line.trim());
  }).join('\n');
  return system.slice(0, start) + kept + system.slice(stop);
}

async function run() {
  const [proxy, token, sourceName, indexList, variant, outputName] = process.argv.slice(2);
  if (!/^http:\/\/127\.0\.0\.1:\d+\/chat\/completions$/u.test(proxy ?? '') || !token) throw Error('Bounded local proxy required');
  for (const name of [sourceName, outputName]) {
    if (!/^[A-Z0-9][A-Z0-9._-]+\.json$/u.test(name ?? '')) throw Error('Use a docs evidence filename');
  }
  const docs = resolve('docs'), sourcePath = resolve(docs, sourceName), outputPath = resolve(docs, outputName);
  if (relative(docs, sourcePath).startsWith('..') || relative(docs, outputPath).startsWith('..') || existsSync(outputPath)) throw Error('Evidence must not be overwritten');
  if (!/^\d+(?:,\d+)?$/u.test(indexList ?? '')) throw Error('Choose one or two frozen turns');
  const indices = indexList.split(',').map(Number);
  if (new Set(indices).size !== indices.length) throw Error('Duplicate turn');
  const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
  if (!source.complete || !['古月娜', '陆雪琪'].includes(source.roleName)) throw Error('Completed role evidence required');
  const cases = indices.map(index => {
    const row = source.rows[index];
    if (!row || row.failed || row.calls.length !== 1 || row.calls[0].replayed || row.calls[0].finish !== 'stop') throw Error('Choose an actual complete one-call source');
    const call = row.calls[0];
    if (call.model !== 'deepseek-flash' || !call.messages?.[0]?.content) throw Error('Unexpected request');
    // Validate transformations before making any paid request.
    ablateOwnedGuidance(call.messages[0].content, source.roleName, variant);
    return { index, row, call };
  });
  const report = { source: sourcePath, roleName: source.roleName, variant, complete: false,
    scope: 'Frozen-context provider comparison only; at most four requests; no DB delivery, streaming, independent scoring or production change. Samples are stochastic, not causal proof.', rows: [] };
  try {
    for (const { index, row, call } of cases) for (const arm of ['original', variant]) {
      const messages = structuredClone(call.messages);
      if (arm !== 'original') messages[0].content = ablateOwnedGuidance(messages[0].content, source.roleName, variant);
      const body = { model: 'deepseek-flash', messages, thinking: call.generation?.thinking,
        reasoning_effort: call.generation?.reasoningEffort, temperature: call.generation?.temperature };
      const startedAt = Date.now();
      const response = await fetch(proxy, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
      const data = await response.json();
      report.rows.push({ index, input: row.input, arm, messages, status: response.status,
        raw: data.choices?.[0]?.message?.content, finish: data.choices?.[0]?.finish_reason, usage: data.usage, durationMs: Date.now() - startedAt });
      writeFileSync(outputPath, JSON.stringify(report, null, 2));
      if (!response.ok) throw Error('Provider comparison failed');
    }
    report.complete = report.rows.length === cases.length * 2 && report.rows.every(row => row.finish === 'stop' && row.raw?.trim());
  } finally { writeFileSync(outputPath, JSON.stringify(report, null, 2)); }
  console.log(`Frozen comparison: ${report.rows.length} requests, complete=${report.complete}; no human-quality verdict`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await run();
