/** Types for the shared gateway/mobile policy. */
export const DEEPSEEK_MODEL_ID: 'deepseek-flash';
export const DEEPSEEK_MODEL_LABEL: string;
export const LEGACY_DEEPSEEK_MODEL_IDS: readonly string[];
export function deepseekGenerationOptions(options?: {
  disableThinking?: boolean;
  visionRequest?: boolean;
  jsonMode?: boolean;
  temperature?: number;
}): { thinking: { type: 'enabled' | 'disabled' }; reasoning_effort?: 'low'; temperature?: number };
