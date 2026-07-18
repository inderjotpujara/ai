// Runs inside the browser's real-time AudioWorkletGlobalScope — NOT
// unit-testable under happy-dom/Vitest (no such runtime exists there). The
// only logic here is wiring `createDownsampler` (Task 5, fully unit-tested
// in isolation) to the Web Audio `process()` callback; verified for real in
// the Part B live-verify increment (Task 18).
//
// `AudioWorkletProcessor`/`registerProcessor` are not part of any standard
// TypeScript lib (`dom` does not include the worklet global scope) — these
// two ambient declarations stand in for the real browser globals so this
// file typechecks; they are never actually defined at compile time, only at
// runtime inside a real AudioWorkletGlobalScope.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
declare function registerProcessor(
  name: string,
  processorCtor: new (
    options?: AudioWorkletNodeOptions,
  ) => AudioWorkletProcessor,
): void;

import { createDownsampler } from './audio-capture.ts';

class DownsampleProcessor extends AudioWorkletProcessor {
  private readonly downsampler: ReturnType<typeof createDownsampler>;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    const inputRate =
      (options?.processorOptions as { inputRate: number } | undefined)
        ?.inputRate ?? 48000;
    this.downsampler = createDownsampler(inputRate);
  }

  override process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0) {
      const chunk16k = this.downsampler.process(channel);
      if (chunk16k.length > 0) {
        this.port.postMessage(chunk16k, [chunk16k.buffer]);
      }
    }
    return true; // keep the processor alive across renders
  }
}

registerProcessor('downsample-processor', DownsampleProcessor);
