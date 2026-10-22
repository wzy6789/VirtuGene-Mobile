import './voice-call-ui';
import { useVoiceCallStore } from '../../src/store/voice-call-store';
import { useVoiceCallUIStore } from '../../src/store/voice-call-ui-store';

/** Actual production dialog, with presentation-only actions. No audio/model adapters are started. */
async function main() {
  await (window as any).callUiTest.hosted();
  const store = useVoiceCallStore;
  const patch = (change: Record<string, unknown>) => store.setState({ view: { ...store.getState().view!, ...change } });
  const devices = [
    { id: 11, type: 7, label: '蓝牙耳机 · 隔离预览', selected: false },
    { id: 12, type: 1, label: '听筒', selected: true },
    { id: 13, type: 2, label: '扬声器', selected: false },
  ];
  let next = 0, cancels = 0, resumes = 0, mode = 'ok', holdCancel = false;
  let finishCancel: (() => void) | undefined;
  let rejectCancel: (() => void) | undefined;
  const selected: number[] = [], oldRequests: ((fail?: boolean) => void)[] = [];
  const wait = (age = 0, legacy = false) => {
    patch({ phase: legacy ? 'paused' : 'listening', routing: !legacy,
      routeWait: { requestId: ++next, deviceId: 11, requestedType: 7, startedAt: Date.now() - age, stage: 'waiting' },
      error: legacy ? 'bluetooth-connecting' : undefined });
  };
  patch({ phase: 'listening', inputMode: 'voice', userText: '', speakingText: '', heardText: '', routing: false, routeWait: undefined, error: undefined,
    capabilities: { sampleRate: 16000, echoCancellation: true, noiseSuppression: true, routes: devices.map(row => ({ ...row })) } });
  store.setState({
    routes: async () => {},
    route: async id => {
      selected.push(id);
      if (id === 11) {
        wait();
        await new Promise<void>((resolve, reject) => oldRequests.push(fail => fail ? reject(Error('voice:route_cancelled')) : resolve()));
        return;
      }
      patch({ phase: 'paused', routing: false, routeWait: undefined, error: undefined,
        capabilities: { ...store.getState().view!.capabilities!, routes: devices.map(row => ({ ...row, selected: row.id === id })) } });
    },
    cancelRouteWait: async () => {
      cancels++;
      if (mode === 'unavailable') { patch({ phase: 'paused', error: 'voice:route_cancel_unavailable' }); throw Error('voice:route_cancel_unavailable'); }
      if (mode === 'failed') { patch({ phase: 'paused', error: 'voice:audio_release_failed' }); throw Error('voice:audio_release_failed'); }
      const routeWait = store.getState().view!.routeWait;
      patch({ phase: 'paused', routeWait: routeWait && { ...routeWait, stage: 'cancelling' } });
      if (holdCancel) await new Promise<void>((resolve, reject) => { finishCancel = resolve; rejectCancel = () => reject(Error('voice:route_cancel_failed')); });
      patch({ phase: 'paused', routing: false, routeWait: undefined, error: 'voice:route_cancelled' });
    },
    resume: async () => { resumes++; patch({ phase: 'listening', error: undefined }); },
    mute: async () => patch({ muted: !store.getState().view!.muted }),
    end: async () => store.setState({ busy: false, view: { ...store.getState().view!, phase: 'ended', routing: false, routeWait: undefined } }),
  });
  Object.assign(window, { routeRecoveryUi: {
    ready: true, wait,
    stats: () => ({ cancels, resumes, selected: [...selected], heldOldRequests: oldRequests.length, phase: store.getState().view!.phase }),
    mode: (value: string) => { mode = value; }, holdCancel: (value: boolean) => { holdCancel = value; }, finishCancel: () => { finishCancel?.(); finishCancel = undefined; rejectCancel = undefined; holdCancel = false; },
    failCancel: () => { rejectCancel?.(); rejectCancel = undefined; finishCancel = undefined; holdCancel = false; },
    finishOld: (fail = false) => { oldRequests.shift()?.(fail); },
    noEarpiece: () => patch({ capabilities: { ...store.getState().view!.capabilities!, routes: devices.filter(row => row.type !== 1).map(row => ({ ...row })) } }),
    legacyWired: () => patch({ capabilities: { ...store.getState().view!.capabilities!, routes: [{ id: -2, type: 3, label: '有线耳机', selected: true }, devices[2]] } }),
    settle: () => patch({ phase: 'paused', routing: false, routeWait: undefined, error: 'voice:route_cancelled' }),
    restart: () => {
      const record = store.getState().record!;
      store.setState({ record: { ...record, id: record.id + '-next' } });
      patch({ phase: 'listening', routing: false, routeWait: undefined, error: undefined });
    },
    reopen: () => useVoiceCallUIStore.getState().restore(),
  } });
}
void main();
