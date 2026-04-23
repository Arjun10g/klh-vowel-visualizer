/**
 * Browser SpeechSynthesis helpers. No backend involvement, no API keys.
 *
 * Voices load asynchronously in some browsers (notably Chrome) — the first
 * call to getVoices() returns []. `subscribeVoices` fires the callback once
 * voices are populated, and again on any voice list update.
 */

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function listVoices(): SpeechSynthesisVoice[] {
  if (!isSpeechSupported()) return [];
  return window.speechSynthesis.getVoices();
}

export function subscribeVoices(cb: (voices: SpeechSynthesisVoice[]) => void): () => void {
  if (!isSpeechSupported()) {
    cb([]);
    return () => {};
  }
  const synth = window.speechSynthesis;
  const handler = () => cb(synth.getVoices());
  handler();
  synth.addEventListener("voiceschanged", handler);
  return () => synth.removeEventListener("voiceschanged", handler);
}

export interface SpeakOptions {
  rate?: number;
  voiceURI?: string | null;
}

export function speak(text: string, opts: SpeakOptions = {}): void {
  if (!isSpeechSupported()) return;
  const synth = window.speechSynthesis;
  // Cancel any in-flight utterance so rapid clicks don't queue up.
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (opts.rate !== undefined) u.rate = opts.rate;
  if (opts.voiceURI) {
    const match = synth.getVoices().find((v) => v.voiceURI === opts.voiceURI);
    if (match) u.voice = match;
  }
  synth.speak(u);
}

export function cancelSpeech(): void {
  if (!isSpeechSupported()) return;
  window.speechSynthesis.cancel();
}
