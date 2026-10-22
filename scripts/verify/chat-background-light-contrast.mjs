import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import postcss from 'postcss';
import { build } from 'esbuild';

// A conservative color calculation, not a browser/pixel or Android audit.
// The current peak is read from the production style object, not duplicated here.
const root = resolve('.');
const out = join(root, '.tmp-preview/chat-background-effects-20261015/light-contrast.json');
const layerFile = 'src/components/chat/ChatBackgroundLayer.tsx';
const paletteFile = 'src/lib/chat-atmosphere.ts';
const cssFile = 'src/styles/chat-atmosphere.css';
const [layerSource, paletteSource, cssSource] = await Promise.all(
  [layerFile, paletteFile, cssFile].map(file => readFile(join(root, file), 'utf8')),
);
const layer = ts.createSourceFile(layerFile, layerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const highAssignments = [], capAssignments = [];
const visit = node => {
  if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && node.name.text === '--chat-light-high') highAssignments.push(node);
  if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && node.name.text === '--chat-light-cap') capAssignments.push(node);
  ts.forEachChild(node, visit);
};
visit(layer);
assert.equal(highAssignments.length, 1, 'Production must have one unambiguous --chat-light-high assignment');
const high = highAssignments[0].initializer;
assert.ok(ts.isConditionalExpression(high) && ts.isIdentifier(high.condition) && high.condition.text === 'vivid', 'Review a changed production opacity expression before calculating its peak');
assert.ok(ts.isNumericLiteral(high.whenTrue) && ts.isNumericLiteral(high.whenFalse), 'Production gentle/vivid peaks must be numeric literals for this verifier');
const vividHigh = Number(high.whenTrue.text), gentleHigh = Number(high.whenFalse.text);
assert.ok(Number.isFinite(vividHigh) && vividHigh >= gentleHigh && gentleHigh >= 0 && vividHigh <= 1, 'Production peaks must be bounded normal alpha values');
const highOpacityUses = [];
postcss.parse(cssSource).walkAtRules('keyframes', rule => {
  if (rule.params === 'vg-chat-edge') rule.walkDecls('opacity', declaration => {
    if (declaration.value.includes('var(--chat-light-high')) highOpacityUses.push(declaration.value);
  });
});
assert.equal(highOpacityUses.length, 1, 'The production light animation must consume the authored high peak');
assert.equal(capAssignments.length,1,'All decorative glow must have one shared compositing ceiling');
const cap=capAssignments[0].initializer;
assert.ok(ts.isConditionalExpression(cap)&&ts.isNumericLiteral(cap.whenTrue)&&ts.isNumericLiteral(cap.whenFalse),'Review changed group opacity expressions');
const vividCap=Number(cap.whenTrue.text),gentleCap=Number(cap.whenFalse.text);
assert.ok(gentleCap>=0&&gentleCap<=vividCap&&vividCap<=1,'Group opacity remains bounded');
let groupOpacity=false;
postcss.parse(cssSource).walkRules(rule=>{
  if(rule.selector==='.vg-chat-background-halo')rule.walkDecls('opacity',d=>{if(d.value.includes('var(--chat-light-cap'))groupOpacity=true;});
  assert.ok(!rule.selector.includes('.vg-chat-atmosphere-edge::before')&&!rule.selector.includes('.vg-chat-atmosphere-edge::after'),'No ungrouped glow pseudo-elements remain');
});
postcss.parse(cssSource).walkAtRules('keyframes',rule=>{
  if(rule.params==='vg-chat-canopy')rule.walkDecls('opacity',()=>assert.fail('Group animation must not override the opacity ceiling'));
});
assert.ok(groupOpacity,'The actual glow group must consume its authored opacity ceiling');

const compiled = await build({ entryPoints:[join(root, paletteFile)], bundle:true, write:false, platform:'node', format:'esm', logLevel:'silent' });
const { CHAT_ATMOSPHERE_THEMES } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const themes = CHAT_ATMOSPHERE_THEMES;
assert.ok(Array.isArray(themes) && themes.length > 0, 'Use the actual exported production palettes');
const threshold = 4.5;
const rgb = color => {
  assert.match(color, /^#[0-9a-f]{6}$/i, 'The calculation requires opaque six-digit sRGB colors');
  return color.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255);
};
const luminance = color => color.map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
  .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
const contrast = (foreground, background) => {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
};
const runMatrix = alpha => {
  const samples = [];
  for (const primary of themes) for (const mode of ['light', 'dark']) for (const companion of themes) for (const content of ['text', 'sub']) {
    const baseColor = primary[mode].bg, glowColor = companion[mode].glow, foreground = primary[mode][content];
    const base = rgb(baseColor), glow = rgb(glowColor);
    // Normal source-over alpha blend in encoded sRGB; keep floats before WCAG linearization.
    const blendedSrgb = base.map((channel, index) => channel * (1 - alpha) + glow[index] * alpha);
    const ratio = contrast(rgb(foreground), blendedSrgb);
    samples.push({ primary:primary.id, companion:companion.id, mode, content, baseColor, glowColor, foreground, alpha, blendedSrgb, ratio, pass:ratio >= threshold });
  }
  const sorted = [...samples].sort((a, b) => a.ratio - b.ratio);
  return { alpha, count:samples.length, passed:samples.every(sample => sample.pass), failed:samples.filter(sample => !sample.pass).length, minimum:sorted[0], samples };
};
const current = runMatrix(vividCap);
// Also bound all possible overlapping hues by a per-channel envelope, including
// the authored secondary colors (which need not equal a companion's main glow).
const envelope=[];
for(const primary of themes)for(const mode of ['light','dark'])for(const content of ['text','sub']){
  const hues=themes.flatMap(theme=>[rgb(theme[mode].glow),rgb(theme[mode].glowSecondary)]);
  const extreme=[0,1,2].map(channel=>(mode==='dark'?Math.max:Math.min)(...hues.map(h=>h[channel])));
  const blended=rgb(primary[mode].bg).map((v,i)=>v*(1-vividCap)+extreme[i]*vividCap);
  const ratio=contrast(rgb(primary[mode][content]),blended);
  envelope.push({primary:primary.id,mode,content,ratio,pass:ratio>=threshold});
}
// Historical sensitivity comparison only: this literal describes the reviewed .32 proposal.
// It does not pretend to restore or execute an earlier source/build/browser frame.
const previousProposal = runMatrix(.32);
const expectedCount = themes.length ** 2 * 2 * 2;
assert.equal(current.count, expectedCount, 'Every primary/companion, theme mode and text/sub combination must be sampled');
assert.equal(previousProposal.count, current.count, 'Compare the same production palettes under only a changed peak alpha');
const hash = source => createHash('sha256').update(source).digest('hex');
const report = {
  recordedAt:new Date().toISOString(), cwd:root, passed:current.passed&&envelope.every(s=>s.pass), threshold,
  source:{
    layer:{file:layerFile, sha256:hash(layerSource), opacityExpression:cap.getText(layer), vividHigh, gentleHigh, vividCap, gentleCap},
    palettes:{file:paletteFile, sha256:hash(paletteSource), themes:themes.map(theme => theme.id)},
    css:{file:cssFile, sha256:hash(cssSource), highOpacityUses},
  },
  method:{
    coverage:'All exported primary themes × all exported companion glow hues × light/dark × bare text/sub colors; includes neutral compatibility palette.',
    blending:'C = base × (1 − alpha) + companion.glow × alpha, per encoded sRGB channel normalized to 0–1; composited floats are retained without 8-bit rounding.',
    contrast:'WCAG sRGB relative luminance: channel/12.92 below .04045, otherwise ((channel+.055)/1.055)^2.4; weights .2126/.7152/.0722; ratio (lighter+.05)/(darker+.05).',
    assumptions:[
      'All light gradients are composited inside one opacity-capped group; even fully overlapping opaque internal gradients cannot exceed the group ceiling. Spatial gradient attenuation is ignored.',
      'The group blends normally behind otherwise bare opaque text; no image, HDR, browser color-management variation or particles are modeled.',
      'The pair matrix tests companion.glow substitution; the additional per-channel envelope bounds every main and authored secondary hue and any interpolation/overlap between them.',
      'Opaque reading bubbles, date labels and header/composer surfaces remain independently covered by their existing palette checks; this does not alter or measure those surfaces.',
    ],
  },
  current,
  envelope,
  previousProposal:{...previousProposal, label:'Counterfactual reviewed .32 high peak with the same current palettes; not an executed historical build.'},
  limits:[
    'A theoretical edge-color guard, not proof that any rendered text overlaps the brightest edge or that a previous actual screenshot failed contrast.',
    'No browser pixel sampling, gradients at individual text coordinates, anti-aliasing, local image backgrounds, particle/arc overlap or actual phone rendering is measured.',
    'No browser, model, microphone, network, GPU/performance, Android or installed-APK test is run by this script.',
  ],
  modelCalls:0, microphoneCalls:0, browserTest:false, nativeDeviceTest:false,
};
await mkdir(resolve(out, '..'), { recursive:true });
await writeFile(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed:current.passed&&envelope.every(s=>s.pass), samplesPerMatrix:current.count, currentPeak:vividCap, currentMinimum:current.minimum.ratio, currentFailures:current.failed, envelopeSamples:envelope.length,envelopeMinimum:Math.min(...envelope.map(s=>s.ratio)),previousPeak:previousProposal.alpha, previousMinimum:previousProposal.minimum.ratio, previousFailures:previousProposal.failed, evidence:out }, null, 2));
assert.ok(current.passed, 'Current production vivid peak must preserve ≥4.5 theoretical bare text/sub contrast in the pair matrix');
assert.ok(envelope.every(s=>s.pass),'Every primary retains >=4.5 even under the conservative mixed-hue channel envelope');
