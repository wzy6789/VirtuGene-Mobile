import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

// The two opt-ins are intentional. Default execution cannot reach a provider.
const allowed = new Set(['--live']);
if (process.argv.slice(2).some(arg => !allowed.has(arg))) throw new Error('Only --live is accepted. Default is isolated dry-run.');
const live = process.argv.includes('--live');
if (live && (process.env.VOICE_LATENCY_ALLOW_PAID !== '1' || !process.env.MIMO_API_KEY?.trim())) {
  throw new Error('Live test requires --live, VOICE_LATENCY_ALLOW_PAID=1 and MIMO_API_KEY. No request was sent.');
}
const root = resolve(import.meta.dirname, '../..');
const snapshot = join(root, '.tmp-preview/voice-call-latency-20261015/before');
for (const name of ['controller.ts', 'utterance.ts']) if (!existsSync(join(snapshot, name))) throw new Error(`Missing comparison snapshot: ${name}`);
const evidence = join(root, '.tmp-preview/voice-call-provider-latency-20261015', `${live ? 'live' : 'dry-run'}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(evidence, { recursive: true });
const wavPath = join(evidence, 'synthetic-huihui-16k.wav');
const speechScript = `Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $speaker.SelectVoice('Microsoft Huihui Desktop')
  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $speaker.SetOutputToWaveFile('${wavPath.replaceAll("'", "''")}', $format)
  $speaker.Speak('今天有点累，想听你说句话。')
} finally { $speaker.Dispose() }`;
const audio = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', speechScript], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
if (audio.status !== 0 || !existsSync(wavPath)) throw new Error('Offline Huihui fixture generation failed. No provider request was sent.');
const hash = value => createHash('sha256').update(value).digest('hex');
const report = {
  mode: live ? 'live-provider-with-isolated-sink' : 'dry-run',
  input: { text: '今天有点累，想听你说句话。', origin: 'offline Microsoft Huihui Desktop / System.Speech', wav: wavPath, sha256: hash(readFileSync(wavPath)), microphoneUsed: false },
  limits: { totalRounds: 4, maxRequestsPerRound: 5, maxRequestsTotal: 20, retries: 0, dialogueMaxTokens: 64 },
  scope: 'Same synthetic audio and fictional character; provider PCM arrival only. No real microphone, private chat, Android hardware, physical playback or conversation-naturalness validation.',
  simulatedDeviceSetup: { milliseconds: 120, appliesToDryRunAndLive: true, meaning: 'Artificial sink beginPlayback delay, not a measured device delay. First network PCM timing includes scheduling around this simulated dependency; it is not pure MiMo service latency.' },
  bundles: {},
  requestCount: 0, actualProviderRequests: 0, rounds: [], errors: [],
};
try {
  for (const variant of ['before', 'after']) {
    const outfile = join(evidence, `${variant}.cjs`);
    await build({ entryPoints: [join(root, 'scripts/verify/voice-call-provider-latency.ts')], outfile, bundle: true, platform: 'node', format: 'cjs',
      plugins: variant === 'before' ? [{ name: 'isolated-before-snapshot', setup(builder) {
        builder.onLoad({ filter: /voice-call[\\/](controller|utterance)\.ts$/ }, args => ({ contents: readFileSync(join(snapshot, args.path.split(/[\\/]/).pop()), 'utf8'), loader: 'ts', resolveDir: dirname(args.path) }));
      } }] : [],
    });
    report.bundles[variant] = { file: outfile, sha256: hash(readFileSync(outfile)) };
  }
  // ABBA limits order effects. Child limits of five make the global ceiling twenty.
  for (const [index, variant] of ['before', 'after', 'after', 'before'].entries()) {
    const output = join(evidence, `round-${index + 1}-${variant}.json`);
    const env = { ...process.env };
    if (!live) { delete env.MIMO_API_KEY; delete env.VOICE_LATENCY_ALLOW_PAID; }
    const result = spawnSync(process.execPath, [join(evidence, `${variant}.cjs`), '--variant', variant, '--round', String(index + 1), '--input', wavPath, '--output', output, ...(live ? ['--live'] : [])],
      { cwd: root, env, encoding: 'utf8', timeout: 100_000, windowsHide: true, maxBuffer: 1_000_000 });
    if (existsSync(output)) {
      const round = JSON.parse(readFileSync(output, 'utf8'));
      report.rounds.push(round); report.requestCount += round.requests.length;
      report.actualProviderRequests += round.actualProviderRequests;
      console.log(JSON.stringify({ round: index + 1, variant, mode: report.mode, requests: round.requests.length, firstPcmAfterSpeechMs: round.timing?.firstPcmAfterSpeechMs, outcome: round.outcome }));
    }
    if (result.status !== 0) throw new Error(`Round ${index + 1} failed; stopped without retry. See its sanitized JSON if available.`);
    if (report.requestCount > 20) throw new Error('Global request ceiling exceeded.');
  }
  if (report.rounds.length !== 4 || report.rounds.some(round => round.outcome !== 'completed')) throw new Error('Four complete rounds were not obtained.');
  report.promptHashes = report.rounds.map(round => round.context.messagesSha256);
  report.sameActualDialogueInputs = new Set(report.promptHashes).size === 1;
  report.comparison = ['before', 'after'].map(variant => {
    const values = report.rounds.filter(round => round.variant === variant).map(round => round.timing.firstPcmAfterSpeechMs).sort((a, b) => a - b);
    return { variant, samples: values.length, firstPcmAfterSpeechMedianMs: (values[0] + values[1]) / 2 };
  });
} catch (error) { report.errors.push(error instanceof Error ? error.message : 'Verification failed.'); process.exitCode = 1; }
finally {
  report.usageNote = live ? 'Only provider-reported usage receipts are recorded per request. Missing usage is not zero; costs and cumulative token totals are not inferred.' : 'No actual model API calls. Usage receipts and delays are synthetic; absent usage is marked not returned.';
  writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ evidence: join(evidence, 'report.json'), actualProviderRequests: report.actualProviderRequests, errors: report.errors }));
}
