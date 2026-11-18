export type UpdateMode = 'installed' | 'portable' | 'development' | 'unsupported';
export type UpdateStatus = {
  mode: UpdateMode;
  phase: 'unavailable' | 'idle' | 'checking' | 'current' | 'downloading' | 'ready' | 'installing' | 'error';
  currentVersion: string;
  version?: string;
  percent?: number;
  message: string;
};
export const RELEASES_URL = 'https://github.com/DSuzuki35/PRMTA/releases/latest';
