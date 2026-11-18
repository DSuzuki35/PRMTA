export type ParakeetAcceleration = 'cpu' | 'directml';
export type ParakeetStatus = {
  managed: boolean;
  supported: boolean;
  phase: 'not-installed' | 'installing' | 'installed' | 'starting' | 'ready' | 'error' | 'unavailable';
  installed: boolean;
  model: string;
  provider: string | null;
  requestedAcceleration?: ParakeetAcceleration;
  received: number;
  total: number;
  percent: number;
  message: string;
  error: string | null;
};
export const PARAKEET_MODEL = 'Parakeet TDT 0.6B v3 · multilingual · INT8';
