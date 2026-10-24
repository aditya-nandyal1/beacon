import { useEffect, useRef } from 'react';

/**
 * CPR metronome: audible click + haptic tick at `bpm`, phase exposed via a ref
 * (0 at the beat, →1 before the next) so the AR ring can "breathe" with it.
 * Uses the Web Audio clock, not setInterval, so it stays locked under load.
 */
export function useMetronome(bpm: number | null, ctxRef: React.MutableRefObject<AudioContext | null>) {
  const phaseRef = useRef(0);
  useEffect(() => {
    if (!bpm) return;
    const ac = ctxRef.current ?? (ctxRef.current = new AudioContext());
    const period = 60 / bpm;
    let next = ac.currentTime + 0.1;
    let alive = true;
    const schedule = () => {
      if (!alive) return;
      while (next < ac.currentTime + 0.25) {
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, next);
        g.gain.exponentialRampToValueAtTime(0.5, next + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, next + 0.06);
        osc.connect(g).connect(ac.destination);
        osc.start(next);
        osc.stop(next + 0.07);
        const delay = Math.max(0, (next - ac.currentTime) * 1000);
        setTimeout(() => navigator.vibrate?.(30), delay);
        next += period;
      }
      requestAnimationFrame(() => {
        const sinceBeat = (ac.currentTime - (next - period)) / period;
        phaseRef.current = Math.min(1, Math.max(0, sinceBeat));
        schedule();
      });
    };
    schedule();
    return () => {
      alive = false;
    };
  }, [bpm, ctxRef]);
  return phaseRef;
}
