import { describe, it, expect } from 'vitest';
import { runPipeline, type WorldgenStage } from '../../src/worldgen/pipeline';

// A stage that records the first few rng draws it receives.
function recordingStage(name: string, sink: Record<string, number[]>): WorldgenStage {
  return {
    name,
    apply(_world, rng) {
      sink[name] = [rng.next(), rng.next(), rng.next()];
    },
  };
}

// A stage that paints the map using its rng — exercises snapshot determinism.
function paintStage(name: string): WorldgenStage {
  return {
    name,
    apply(world, rng) {
      for (let i = 0; i < 50; i++) {
        const x = rng.nextInt(world.map.width);
        const y = rng.nextInt(world.map.height);
        world.map.setElevation(x, y, rng.next());
      }
    },
  };
}

describe('runPipeline', () => {
  it('runs stages in order, recording each in the log', () => {
    const world = runPipeline({ seed: 's' }, [
      paintStage('alpha'),
      paintStage('beta'),
      paintStage('gamma'),
    ]);
    expect(world.log).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('defaults to a 128x128 map and carries the seed', () => {
    const world = runPipeline({ seed: 'abc' }, []);
    expect(world.map.width).toBe(128);
    expect(world.map.height).toBe(128);
    expect(world.seed).toBe('abc');
  });

  it('gives each stage a different rng stream', () => {
    const sink: Record<string, number[]> = {};
    runPipeline({ seed: 's' }, [recordingStage('a', sink), recordingStage('b', sink)]);
    expect(sink['a']).not.toEqual(sink['b']);
  });

  it('same seed + same stages yields an identical map snapshot', () => {
    const stages = () => [paintStage('a'), paintStage('b')];
    const w1 = runPipeline({ seed: 'world-1', width: 32, height: 32 }, stages());
    const w2 = runPipeline({ seed: 'world-1', width: 32, height: 32 }, stages());
    expect(w1.map.snapshot()).toBe(w2.map.snapshot());
  });

  it('different seeds yield different map snapshots', () => {
    const stages = () => [paintStage('a'), paintStage('b')];
    const w1 = runPipeline({ seed: 'world-1', width: 32, height: 32 }, stages());
    const w3 = runPipeline({ seed: 'world-2', width: 32, height: 32 }, stages());
    expect(w3.map.snapshot()).not.toBe(w1.map.snapshot());
  });

  it('removing a stage does not perturb a later stage rng stream', () => {
    // The core determinism contract: stage rng is forked by name from the
    // root seed, independent of sibling stages. Dropping B must not change
    // what C sees.
    const sinkABC: Record<string, number[]> = {};
    runPipeline({ seed: 's' }, [
      recordingStage('a', sinkABC),
      recordingStage('b', sinkABC),
      recordingStage('c', sinkABC),
    ]);

    const sinkAC: Record<string, number[]> = {};
    runPipeline({ seed: 's' }, [recordingStage('a', sinkAC), recordingStage('c', sinkAC)]);

    expect(sinkAC['c']).toEqual(sinkABC['c']);
  });
});
