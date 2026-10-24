import { useEffect, useRef } from 'react';
import type { ArHint } from '@beacon/protocols';

/**
 * AR overlay — a canvas drawn over the live camera feed.
 *
 * Layers:
 *  1. Scene annotations from the latest triage frame: people (state-coloured),
 *     hazards (red, pulsing when urgent), resources (green, with a label like "AED").
 *  2. Step-specific guidance from the protocol's ArHint: CPR hand-position target
 *     on the detected person's chest, a compression metronome ring that beats at
 *     110 bpm, a recovery-position pictogram, a tourniquet guide, or a direction
 *     arrow toward an exit / away from a hazard.
 *
 * Boxes are normalized [x,y,w,h] so they survive any resize; the overlay matches
 * the <video> element's object-fit: cover geometry.
 */

export interface Box { bbox: [number, number, number, number] | null; label: string; kind: string; urgent?: boolean }
export interface OverlayScene {
  people: Array<{ id: string; state: string; posture: string; bbox: [number, number, number, number] | null }>;
  hazards: Box[];
  resources: Box[];
}

export function AROverlay({ scene, hint, videoRef, beatRef }: { scene: OverlayScene | null; hint: ArHint | null; videoRef: React.RefObject<HTMLVideoElement>; beatRef: React.MutableRefObject<number> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef(scene);
  const hintRef = useRef(hint);
  sceneRef.current = scene;
  hintRef.current = hint;

  useEffect(() => {
    let raf = 0;
    const draw = (t: number) => {
      const c = canvasRef.current;
      const v = videoRef.current;
      if (!c || !v) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth, H = c.clientHeight;
      if (c.width !== W * dpr || c.height !== H * dpr) {
        c.width = W * dpr;
        c.height = H * dpr;
      }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // Map normalized video coords → screen (object-fit: cover).
      const vw = v.videoWidth || 16, vh = v.videoHeight || 9;
      const s = Math.max(W / vw, H / vh);
      const dw = vw * s, dh = vh * s, ox = (W - dw) / 2, oy = (H - dh) / 2;
      const toScreen = (b: [number, number, number, number]) => [ox + b[0] * dw, oy + b[1] * dh, b[2] * dw, b[3] * dh] as const;

      const sc = sceneRef.current;
      const pulse = 0.5 + 0.5 * Math.sin(t / 180);
      if (sc) {
        for (const h of sc.hazards) if (h.bbox) corners(ctx, toScreen(h.bbox), h.urgent ? `rgba(255,77,77,${0.6 + 0.4 * pulse})` : 'rgba(255,140,60,0.9)', h.label.toUpperCase(), h.urgent ? 3 : 2);
        for (const r of sc.resources) if (r.bbox) corners(ctx, toScreen(r.bbox), 'rgba(80,230,140,0.95)', r.kind === 'aed' ? 'AED' : r.label.toUpperCase(), 2, true);
        for (const p of sc.people) if (p.bbox) corners(ctx, toScreen(p.bbox), p.state === 'unresponsive' ? 'rgba(255,77,77,0.9)' : p.state === 'distressed' ? 'rgba(255,200,60,0.9)' : 'rgba(120,180,255,0.8)', p.state === 'unknown' ? 'PERSON' : p.state.toUpperCase(), 2);
      }

      const hint = hintRef.current;
      const person = sc?.people.find((p) => p.posture === 'lying' && p.bbox) ?? sc?.people.find((p) => p.bbox);
      if (hint?.kind === 'hand_position' || hint?.kind === 'cpr_metronome') {
        // Target the centre of the chest: ~40% down a lying person's box, horizontally centred.
        let cx = W / 2, cy = H * 0.55;
        if (person?.bbox) {
          const [x, y, w, h] = toScreen(person.bbox);
          const horizontal = w > h;
          cx = x + (horizontal ? w * 0.42 : w * 0.5);
          cy = y + (horizontal ? h * 0.5 : h * 0.38);
        }
        const beat = beatRef.current; // 0..1 phase within the current beat
        const r = 34 + (hint.kind === 'cpr_metronome' ? 14 * (1 - beat) : 6 * pulse);
        ctx.lineWidth = 4;
        ctx.strokeStyle = hint.kind === 'cpr_metronome' && beat < 0.15 ? '#ffffff' : 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,77,77,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 18, cy); ctx.lineTo(cx + 18, cy); ctx.moveTo(cx, cy - 18); ctx.lineTo(cx, cy + 18);
        ctx.stroke();
        label(ctx, cx, cy + r + 22, hint.kind === 'cpr_metronome' ? 'PUSH WITH THE BEAT' : 'HEEL OF HAND HERE');
      } else if (hint?.kind === 'arrow_to') {
        // Direction: toward an exit/resource if we see one, else "away" = behind the user.
        const target = sc?.resources.find((r) => (hint.target === 'exit' && r.kind === 'exit') || (hint.target === 'aed' && r.kind === 'aed') || (hint.target === 'high_ground' && r.kind === 'high_ground'));
        const hazard = sc?.hazards.find((h) => h.bbox);
        let angle = Math.PI; // default: turn around
        if (target?.bbox) {
          const [x, y, w, h] = toScreen(target.bbox);
          angle = Math.atan2(y + h / 2 - H / 2, x + w / 2 - W / 2);
        } else if (hint.target === 'away_from_hazard' && hazard?.bbox) {
          const [x, , w] = toScreen(hazard.bbox);
          angle = x + w / 2 < W / 2 ? 0 : Math.PI;
        }
        arrow(ctx, W / 2, H * 0.62, angle, 70 + 10 * pulse, target ? `TO ${hint.target.replace('_', ' ').toUpperCase()}` : hint.target === 'away_from_hazard' ? 'MOVE AWAY' : `FIND ${hint.target.replace('_', ' ').toUpperCase()}`);
      } else if (hint?.kind === 'recovery_position') {
        pictogramRecovery(ctx, W / 2, H * 0.6, pulse);
      } else if (hint?.kind === 'tourniquet_guide') {
        pictogramTourniquet(ctx, W / 2, H * 0.6, pulse);
      } else if (hint?.kind === 'highlight' && sc) {
        const found = sc.resources.filter((r) => hint.targets.includes(r.kind as never) && r.bbox);
        if (!found.length) label(ctx, W / 2, H * 0.14, `LOOK FOR: ${hint.targets.map((x) => x.replace('_', ' ').toUpperCase()).join(' · ')}`);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [videoRef, beatRef]);

  return <canvas ref={canvasRef} className="ar" aria-hidden="true" />;
}

function corners(ctx: CanvasRenderingContext2D, b: readonly [number, number, number, number], color: string, text: string, lw: number, dashed = false) {
  const [x, y, w, h] = b;
  const L = Math.min(28, w / 3, h / 3);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.setLineDash(dashed ? [6, 4] : []);
  ctx.beginPath();
  ctx.moveTo(x, y + L); ctx.lineTo(x, y); ctx.lineTo(x + L, y);
  ctx.moveTo(x + w - L, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + L);
  ctx.moveTo(x + w, y + h - L); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - L, y + h);
  ctx.moveTo(x + L, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - L);
  ctx.stroke();
  ctx.setLineDash([]);
  tag(ctx, x, y - 8, text, color);
}

function tag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) {
  ctx.font = '600 12px ui-sans-serif, system-ui';
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(x, y - 16, w, 18);
  ctx.fillStyle = color;
  ctx.fillText(text, x + 6, y - 3);
}

function label(ctx: CanvasRenderingContext2D, cx: number, y: number, text: string) {
  ctx.font = '700 14px ui-sans-serif, system-ui';
  const w = ctx.measureText(text).width + 20;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  roundRect(ctx, cx - w / 2, y - 14, w, 26, 13);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(text, cx, y + 5);
  ctx.textAlign = 'left';
}

function arrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, angle: number, len: number, text: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.strokeStyle = 'rgba(80,230,140,0.95)';
  ctx.fillStyle = 'rgba(80,230,140,0.95)';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-len / 2, 0); ctx.lineTo(len / 2 - 14, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(len / 2, 0); ctx.lineTo(len / 2 - 26, -18); ctx.lineTo(len / 2 - 26, 18); ctx.closePath();
  ctx.fill();
  ctx.restore();
  label(ctx, cx, cy + 60, text);
}

function pictogramRecovery(ctx: CanvasRenderingContext2D, cx: number, cy: number, pulse: number) {
  ctx.save();
  ctx.translate(cx - 70, cy);
  ctx.strokeStyle = `rgba(255,255,255,${0.75 + 0.25 * pulse})`;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  // head
  ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.stroke();
  // torso on side
  ctx.beginPath(); ctx.moveTo(14, 4); ctx.lineTo(90, 10); ctx.stroke();
  // top leg bent forward
  ctx.beginPath(); ctx.moveTo(90, 10); ctx.lineTo(120, -10); ctx.lineTo(150, 8); ctx.stroke();
  // bottom leg straight
  ctx.beginPath(); ctx.moveTo(90, 10); ctx.lineTo(150, 24); ctx.stroke();
  // arm under head
  ctx.beginPath(); ctx.moveTo(30, 6); ctx.lineTo(8, 18); ctx.stroke();
  ctx.restore();
  label(ctx, cx, cy + 60, 'ON THEIR SIDE · HEAD BACK · KNEE BENT');
}

function pictogramTourniquet(ctx: CanvasRenderingContext2D, cx: number, cy: number, pulse: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  // limb
  ctx.beginPath(); ctx.moveTo(-90, -24); ctx.lineTo(90, -24); ctx.moveTo(-90, 24); ctx.lineTo(90, 24); ctx.stroke();
  // wound
  ctx.fillStyle = 'rgba(255,77,77,0.9)';
  ctx.beginPath(); ctx.arc(40, 0, 10 + 2 * pulse, 0, Math.PI * 2); ctx.fill();
  // band 2-3 inches above (toward heart)
  ctx.strokeStyle = 'rgba(80,230,140,0.95)';
  ctx.lineWidth = 12;
  ctx.beginPath(); ctx.moveTo(-10, -30); ctx.lineTo(-10, 30); ctx.stroke();
  ctx.restore();
  label(ctx, cx, cy + 62, 'BAND 2–3 IN. ABOVE WOUND · NOT ON A JOINT');
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
