import type { SecretaryPersonality } from './personality';

export type SecretaryResponseMode = 'casual' | 'advice' | 'clarify' | 'work';
export type SecretaryAcknowledgementCode = 'tired' | 'anxious' | 'frustrated' | 'neutral';
export type SecretaryMissingField = 'purpose' | 'title' | 'content' | 'query' | 'date' | 'time' | 'target' | 'audience' | 'destination' | 'intervalDays' | 'operation';
export interface SecretaryPlanningContract {
  responseMode: SecretaryResponseMode;
  acknowledgementCode: SecretaryAcknowledgementCode;
  clarification?: { missingFields: SecretaryMissingField[] };
}

/** No model prose, status or arbitrary code is accepted as an acknowledgement. */
export function parsePlanningContract(raw: Record<string, unknown>): SecretaryPlanningContract | undefined {
  if (raw.responseMode == null && raw.acknowledgementCode == null && raw.clarification == null) return undefined;
  const modes = ['casual', 'advice', 'clarify', 'work'];
  const codes = ['tired', 'anxious', 'frustrated', 'neutral'];
  const fields = ['purpose', 'title', 'content', 'query', 'date', 'time', 'target', 'audience', 'destination', 'intervalDays', 'operation'];
  const clarification = raw.clarification && typeof raw.clarification === 'object' && !Array.isArray(raw.clarification)
    ? (raw.clarification as Record<string, unknown>).missingFields : undefined;
  return {
    responseMode: modes.includes(String(raw.responseMode)) ? raw.responseMode as SecretaryResponseMode : 'work',
    acknowledgementCode: codes.includes(String(raw.acknowledgementCode)) ? raw.acknowledgementCode as SecretaryAcknowledgementCode : 'neutral',
    ...(Array.isArray(clarification) ? { clarification: { missingFields: [...new Set(clarification.filter((v): v is SecretaryMissingField => typeof v === 'string' && fields.includes(v)))] } } : {}),
  };
}

const ACKNOWLEDGEMENTS: Record<SecretaryAcknowledgementCode, Record<SecretaryPersonality, readonly string[]>> = {
  neutral: { professional: ['收到。', '明白，先核对这一项。', '好，按当前安排处理。'], balanced: ['行，我们把这件事理清。', '行，按你说的来。', '好，我们接着理。'], gentle: ['好，我听清了。', '好，按你的节奏来。', '这件事我跟你一起理清。'], energetic: ['收到，我们一件件来！', '好，先从眼前这件开始！', '收到，按你的安排来！'], playful: ['行，先理这一件。', '行，先抓住这件小事。', '好，照你的主意来。'] },
  tired: { professional: ['先歇一会儿。', '累了可以先暂停一下。'], balanced: ['今天消耗有点大，先缓口气。', '先歇一下，我们一件件来。'], gentle: ['你已经很累了，先歇一会儿。', '今天辛苦了，不用急着撑下去。'], energetic: ['先给自己留个喘气的空当。', '累了就缓缓，今天不用冲刺。'], playful: ['累了就缓缓，先别跟琐事硬碰硬。', '行，今天先给自己松口气。'] },
  anxious: { professional: ['先缓口气，再看眼前这一项。', '先只看这一件，不必同时解决所有问题。', '先把确定的部分说清。'], balanced: ['不用同时扛几件事，我们先理眼前这件。', '我们先抓住眼前这一点。', '不急着一口气解决，先理一件。'], gentle: ['不用急着一下想清楚，慢慢来。', '还没想清楚的部分，可以先留着。', '你不用一下把每个细节都解释好。'], energetic: ['先缓一下，一次看一件就好。', '先把步子放小，一次一件。', '不用冲刺，先顾眼前这一点。'], playful: ['先别跟一团乱麻较劲，一件件来。', '这团乱麻先别硬拽，找一个线头就够。', '先不跟所有麻烦同时开战。'] },
  frustrated: { professional: ['这件事让你费心了。', '这次确实不顺。', '先看清问题，不急着评价自己。'], balanced: ['这件事挺磨人，我们先理清楚。', '这一下确实让人泄气。', '不顺归不顺，我们先看具体是哪一处。'], gentle: ['听起来这件事让你很不好受。', '这份失落，不用急着掩过去。', '现在不好受，也不用立刻说服自己振作。'], energetic: ['先缓口气，不用硬撑着。', '今天先不用打起精神给谁看。', '不顺的时候，允许自己先停一下。'], playful: ['这点麻烦够磨人的，先喘口气。', '这回不讲段子，先认真听你说。', '不顺就直说，不用给自己扣帽子。'] },
};

/** Deterministic variation survives retries; every phrase describes emotion, never execution. */
export function planningAcknowledgement(contract: SecretaryPlanningContract, personality: SecretaryPersonality, seed: string): string {
  const code = Object.prototype.hasOwnProperty.call(ACKNOWLEDGEMENTS, contract.acknowledgementCode) ? contract.acknowledgementCode : 'neutral';
  const phrases = ACKNOWLEDGEMENTS[code][personality];
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return phrases[hash % phrases.length];
}

export function planningClarification(contract: SecretaryPlanningContract): string {
  const fields = contract.clarification?.missingFields ?? [];
  if (fields.includes('purpose')) return '记成待办还是日记？';
  if (fields.includes('target')) return '你指的是哪一项？';
  if (fields.includes('title')) return '要记哪件事？';
  if (fields.includes('date') && fields.includes('time')) return '哪一天、几点？';
  if (fields.includes('date')) return '哪一天？';
  if (fields.includes('time')) return '几点？';
  if (fields.includes('audience')) return '这条朋友圈想给谁看？';
  return '这次还没有执行操作。想记录或安排什么，直接告诉我。';
}
