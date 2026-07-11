import { LIVE_FORMANT_FRAME_HOP, LIVE_FORMANT_FRAME_SIZE } from "../lib/liveFormants";

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

// 46 ms at 44.1 kHz, with a 1/2 overlap. This is long enough for stable LPC
// estimates while still allowing short vowels to produce trace points.
class LiveFormantCaptureProcessor extends AudioWorkletProcessor {
  private frame = new Float32Array(LIVE_FORMANT_FRAME_SIZE);
  private offset = 0;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;

    let cursor = 0;
    while (cursor < input.length) {
      const writable = Math.min(input.length - cursor, LIVE_FORMANT_FRAME_SIZE - this.offset);
      this.frame.set(input.subarray(cursor, cursor + writable), this.offset);
      this.offset += writable;
      cursor += writable;

      if (this.offset === LIVE_FORMANT_FRAME_SIZE) {
        const frame = this.frame.slice();
        this.port.postMessage(frame, [frame.buffer]);
        this.frame.copyWithin(0, LIVE_FORMANT_FRAME_HOP);
        this.offset = LIVE_FORMANT_FRAME_SIZE - LIVE_FORMANT_FRAME_HOP;
      }
    }

    return true;
  }
}

registerProcessor("live-formant-capture", LiveFormantCaptureProcessor);

export {};
