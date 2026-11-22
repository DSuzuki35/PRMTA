export type SystemSpeechLanguage = 'en' | 'de' | 'auto';
export type SystemSpeechStatus = {
  managed: boolean;
  supported: boolean;
  platform: string;
  engine: string;
  phase: 'unavailable' | 'available' | 'starting' | 'ready' | 'error';
  languages: string[];
  message: string;
  error?: string | null;
};
