import { estimateFormants, type FormantEstimate, type FormantEstimateOptions } from "../lib/liveFormants";

interface WorkerRequest {
  frame: Float32Array<ArrayBuffer>;
  sampleRate: number;
  elapsed: number;
  options: FormantEstimateOptions;
}

interface WorkerResponse {
  estimate: FormantEstimate | null;
  elapsed: number;
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const { frame, sampleRate, elapsed, options } = event.data;
  const estimate = estimateFormants(frame, sampleRate, options);
  self.postMessage({ estimate, elapsed } satisfies WorkerResponse);
});

export {};

