// Fixed-timestep simulation loop (accumulator pattern).
//
// The sim advances in discrete fixed-size ticks regardless of frame timing,
// which keeps simulation behaviour deterministic and decoupled from render
// cadence. This module is pure: no DOM, no timers, no requestAnimationFrame.
// The host drives it by calling advance(elapsedMs) once per rendered frame
// (wiring lives in the UI layer, Task 9).

export interface FixedTickLoopOptions {
  /**
   * Maximum elapsed time honoured in a single advance() call. Larger deltas
   * are clamped to this, preventing a "spiral of death" after a long stall
   * (e.g. a backgrounded tab) where catch-up ticks would themselves take
   * longer than the time they consume. Defaults to 1000ms.
   */
  maxFrameMs?: number;
}

export class FixedTickLoop {
  readonly tickMs: number;
  private readonly onTick: (tick: number) => void;
  private readonly maxFrameMs: number;
  private accumulator = 0;
  private _tickCount = 0;

  constructor(
    tickMs: number,
    onTick: (tick: number) => void,
    opts: FixedTickLoopOptions = {},
  ) {
    if (!(tickMs > 0)) {
      throw new RangeError(`tickMs must be a positive number, got ${tickMs}`);
    }
    this.tickMs = tickMs;
    this.onTick = onTick;
    this.maxFrameMs = opts.maxFrameMs ?? 1000;
  }

  /** Number of ticks fired since construction. */
  get tickCount(): number {
    return this._tickCount;
  }

  /**
   * Fraction of a tick currently accumulated, in [0, 1). Intended for render
   * interpolation between the last and next simulation state.
   */
  get alpha(): number {
    return this.accumulator / this.tickMs;
  }

  /**
   * Accumulate elapsed wall-clock time and fire 0..n ticks. Zero or negative
   * elapsed is a no-op; pathological elapsed is clamped to maxFrameMs.
   */
  advance(elapsedMs: number): void {
    if (!(elapsedMs > 0)) return;
    this.accumulator += elapsedMs > this.maxFrameMs ? this.maxFrameMs : elapsedMs;
    while (this.accumulator >= this.tickMs) {
      this.accumulator -= this.tickMs;
      this.onTick(this._tickCount);
      this._tickCount++;
    }
  }
}
