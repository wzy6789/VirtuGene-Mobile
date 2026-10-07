import { useSettingsStore } from '../store/settings-store';
import { useAuthStore } from '../store/auth-store';
import { IS_CAPACITOR } from './platform';

type Kind = 'selection' | 'light' | 'medium' | 'success' | 'warning' | 'error';
let last = -Infinity;
const silence = new Set<symbol>();
let nativeBusy = false;
let blurred = false, revision = 0;
let native: Promise<typeof import('@capacitor/haptics')> | undefined;

/** Request owners release their token in finally; stale account tokens cannot mute a new user. */
export function holdHapticSilence(): () => void {
  const token = Symbol(); silence.add(token); revision++;
  return () => { silence.delete(token); };
}
const unsubscribeAuth = useAuthStore.subscribe((state, previous) => { if (state.userId !== previous.userId) { silence.clear(); revision++; } });
const unsubscribeSettings = useSettingsStore.subscribe((state, previous) => { if (state.hapticsEnabled !== previous.hapticsEnabled) revision++; });
const blur = () => { blurred = true; revision++; };
const focus = () => { blurred = false; };
const hidden = () => { if (document.hidden) revision++; };
window.addEventListener('blur',blur); window.addEventListener('focus',focus); document.addEventListener('visibilitychange',hidden);
if (import.meta.hot) import.meta.hot.dispose(() => { unsubscribeAuth(); unsubscribeSettings(); window.removeEventListener('blur',blur); window.removeEventListener('focus',focus); document.removeEventListener('visibilitychange',hidden); revision++; });
const allowed = () => useSettingsStore.getState().hapticsEnabled && !document.hidden && !blurred && !silence.size;

/** Leading-only, optional feedback. No queued vibrations and no React frame updates. */
function emit(kind: Kind) {
  const now = performance.now();
  if (!allowed() || nativeBusy || now - last < 60) return;
  last = now;
  if (!IS_CAPACITOR) {
    try { navigator.vibrate?.(kind === 'selection' ? 4 : kind === 'light' || kind === 'medium' ? 10 : [14, 40, 14]); } catch { /* Optional hardware. */ }
    return;
  }
  const userId = useAuthStore.getState().userId;
  const version = revision;
  nativeBusy = true;
  void (native ??= import('@capacitor/haptics')).then(async ({ Haptics, ImpactStyle, NotificationType }) => {
    if (!allowed() || version !== revision || useAuthStore.getState().userId !== userId || performance.now() - now > 60) return;
    if (kind === 'selection') {
      try {
        await Haptics.selectionStart();
        if (allowed() && version === revision && useAuthStore.getState().userId === userId && performance.now() - now <= 60) await Haptics.selectionChanged();
      } finally { await Haptics.selectionEnd(); }
    } else if (kind === 'light' || kind === 'medium') {
      await Haptics.impact({ style: kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light });
    } else {
      await Haptics.notification({ type: kind === 'success' ? NotificationType.Success : kind === 'warning' ? NotificationType.Warning : NotificationType.Error });
    }
  }).catch(() => undefined).finally(() => { nativeBusy = false; });
}
export function warmHaptics() { if (IS_CAPACITOR) void (native ??= import('@capacitor/haptics')).catch(() => undefined); }
export const breathe = () => emit('selection');
export const confirm = (medium = false) => emit(medium ? 'medium' : 'light');
export const resonate = (kind: 'success' | 'warning' | 'error') => emit(kind);
