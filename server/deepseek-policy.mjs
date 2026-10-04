/** Official rolling Flash alias. Ship alongside gateway.mjs; also bundled into mobile. */
export const DEEPSEEK_MODEL_ID = 'deepseek-flash';
export const DEEPSEEK_MODEL_LABEL = 'DeepSeek V4.1 Flash';
export const LEGACY_DEEPSEEK_MODEL_IDS = Object.freeze([
  'deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash',
  'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp',
]);

/** Keep thinking bounded for interactive requests; JSON/vision/recovery need direct output. */
export function deepseekGenerationOptions({ disableThinking = false, visionRequest = false, jsonMode = false, temperature = 0.8 } = {}) {
  if (disableThinking || visionRequest || jsonMode) {
    return {
      thinking: { type: 'disabled' },
      temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : 0.8,
    };
  }
  // temperature is ignored in thinking mode; don't advertise it as effective.
  return { thinking: { type: 'enabled' }, reasoning_effort: 'low' };
}
