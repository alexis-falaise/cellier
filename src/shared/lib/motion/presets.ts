import { type Transition, useReducedMotion } from 'motion/react';

/*
 * The only place transition objects are defined (02 §2.1). Motion converts { bounce, visualDuration } with
 * ζ = 1 − bounce and ω₀ = 2π / (1.2 × visualDuration), checked against motion-dom 14.12 (02 §2.2).
 */
export const presets = {
  press: { type: 'spring', bounce: 0, visualDuration: 0.16 },
  snappy: { type: 'spring', bounce: 0, visualDuration: 0.22 },
  smooth: { type: 'spring', bounce: 0, visualDuration: 0.35 },
  push: { type: 'spring', bounce: 0, visualDuration: 0.42 },
  sheet: { type: 'spring', bounce: 0, visualDuration: 0.38 },
  fling: { type: 'spring', bounce: 0.18, visualDuration: 0.34 },
  pop: { type: 'spring', bounce: 0.3, visualDuration: 0.28 },
  reduced: { type: 'tween', duration: 0.18, ease: 'easeOut' },
} as const satisfies Record<string, Transition>;

export type PresetName = keyof typeof presets;
export type BasePreset = Exclude<PresetName, 'fling' | 'reduced'>;

/** Releases slower than this are stationary: base preset, no bounce (02 §1.3). */
export const STATIONARY_VELOCITY = 100;

/** Returns the preset, or `reduced` when the user prefers reduced motion (non-gesture transitions only). */
export function usePreset(name: PresetName): Transition {
  const reduced = useReducedMotion();
  return reduced ? presets.reduced : presets[name];
}

/** The preset to use without React (imperative `animate` calls). */
export function presetFor(name: PresetName, reducedMotion: boolean | null): Transition {
  return reducedMotion ? presets.reduced : presets[name];
}

/**
 * Transition for the release of a finger drag (02 §1.3, §8.2): `fling` with the hand-off velocity at 100 px/s or
 * more, otherwise the base preset. Under Reduce Motion the remaining distance completes with `snappy`, no bounce.
 */
export function releaseTransition(velocity: number, base: BasePreset, reducedMotion: boolean | null): Transition {
  if (reducedMotion) return { ...presets.snappy, velocity };
  if (Math.abs(velocity) >= STATIONARY_VELOCITY) return { ...presets.fling, velocity };
  return { ...presets[base], velocity };
}

/** Number pop: a spring started at its own target with an initial velocity (02 §4.1, §4.3). */
export const IMPULSE = {
  quantity: 5,
  quantityCap: 8,
  reticle: -3,
} as const;

export function impulseTransition(velocity: number): Transition {
  return { ...presets.pop, velocity };
}
