import { omitUnsupportedUserAudio } from '../chat-user-audio-risk';
import { omitUnsupportedUserVisual } from '../chat-user-visual-risk';

/** Dialogue receives an ASR transcript, never microphone waveforms or a current camera feed. */
export function reviewCallSpeech(text: string,userText=''): string {
  return omitUnsupportedUserVisual(omitUnsupportedUserAudio(text), false,userText,false).trim();
}
