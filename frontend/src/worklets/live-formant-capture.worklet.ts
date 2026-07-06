declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

const FRAME_SIZE = 4096;

class LiveFormantCaptureProcessor extends AudioWorkletProcessor {
  private frame = new Float32Array(FRAME_SIZE);
  private offset = 0;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;

    let cursor = 0;
    while (cursor < input.length) {
      const writable = Math.min(input.length - cursor, FRAME_SIZE - this.offset);
      this.frame.set(input.subarray(cursor, cursor + writable), this.offset);
      this.offset += writable;
      cursor += writable;

      if (this.offset === FRAME_SIZE) {
        const frame = this.frame;
        this.port.postMessage(frame, [frame.buffer]);
        this.frame = new Float32Array(FRAME_SIZE);
        this.offset = 0;
      }
    }

    return true;
  }
}

registerProcessor("live-formant-capture", LiveFormantCaptureProcessor);

export {};
