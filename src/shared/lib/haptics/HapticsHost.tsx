import { useEffect } from 'react';
import { mountHapticSwitch } from './haptics';

/** Mounts the hidden haptic switch once at app start (04 §9). Renders nothing. */
export function HapticsHost() {
  useEffect(() => {
    mountHapticSwitch();
  }, []);
  return null;
}
