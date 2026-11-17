export function audioLevels(samples: Float32Array): { db: number; peakDb: number; clipped: boolean } {
  let sum = 0, peak = 0;
  for (const sample of samples) { sum += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
  const decibels = (value: number) => Math.min(0, Math.max(-60, 20 * Math.log10(Math.max(.001, value))));
  return { db: decibels(Math.sqrt(sum / Math.max(1, samples.length))), peakDb: decibels(peak), clipped: peak >= .98 };
}
export const voiceTiming = { responsive: { interval: 500, window: 3, minimum: 1 }, steady: { interval: 1000, window: 5, minimum: 1.5 } } as const;
