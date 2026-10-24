/**
 * Camera capture. Frames are downscaled to ≤768px and JPEG-encoded at q=0.6
 * (≈60–90 KB) before upload: enough for scene understanding, small enough for
 * a 2.5s cadence on LTE. Nothing is stored locally or remotely.
 */
export async function openCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  await video.play();
  return stream;
}

export function captureJpegBase64(video: HTMLVideoElement, maxSide = 768, quality = 0.6): string | null {
  if (!video.videoWidth) return null;
  const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  const c = captureJpegBase64.canvas ?? (captureJpegBase64.canvas = document.createElement('canvas'));
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const dataUrl = c.toDataURL('image/jpeg', quality);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}
captureJpegBase64.canvas = null as HTMLCanvasElement | null;

/** Cheap motion score (mean abs diff on a 32x18 thumbnail) so we skip uploads of static frames. */
export function motionScore(video: HTMLVideoElement, prev: { data: Uint8ClampedArray | null }): number {
  const c = motionScore.canvas ?? (motionScore.canvas = document.createElement('canvas'));
  c.width = 32;
  c.height = 18;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx || !video.videoWidth) return 1;
  ctx.drawImage(video, 0, 0, 32, 18);
  const d = ctx.getImageData(0, 0, 32, 18).data;
  let s = 0;
  if (prev.data) for (let i = 0; i < d.length; i += 4) s += Math.abs(d[i] - prev.data[i]);
  prev.data = new Uint8ClampedArray(d);
  return prev.data ? s / (d.length / 4) / 255 : 1;
}
motionScore.canvas = null as HTMLCanvasElement | null;
