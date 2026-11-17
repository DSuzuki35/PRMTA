// Official whisper.cpp GGML artifacts, pinned by size and SHA-256 (2026-11-17).
export const whisperModels = [
  { id: 'tiny', name: 'Tiny', file: 'ggml-tiny.bin', size: 77691713, sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21', description: 'Fastest option for modest CPUs. Lower accuracy with accents or noise.' },
  { id: 'base', name: 'Base · bundled', file: 'ggml-base.bin', size: 147951465, sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe', description: 'Lightweight multilingual default. Start here for responsive voice following.' },
  { id: 'small-q5', name: 'Small · Q5', file: 'ggml-small-q5_1.bin', size: 190085487, sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb', description: 'A compact accuracy upgrade. More CPU work than Base; less storage than full Small.' },
  { id: 'small', name: 'Small', file: 'ggml-small.bin', size: 487601967, sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b', description: 'Improved multilingual accuracy. Test latency on your computer before a live take.' },
  { id: 'turbo-q5', name: 'Large v3 Turbo · Q5', file: 'ggml-large-v3-turbo-q5_0.bin', size: 574041195, sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2', description: 'Higher-capacity multilingual recognition in a smaller download. Needs a powerful CPU; GPU server recommended for low latency.' },
] as const;
export type WhisperModelId = typeof whisperModels[number]['id'];
export function modelById(id: string) { const model = whisperModels.find(m => m.id === id); if (!model) throw new Error('Unknown model'); return model; }
export type ModelStatus = { id: WhisperModelId; installed: boolean; downloading: boolean; received: number; error: string };
export type ModelsInfo = { managed: boolean; models: ModelStatus[]; activeModel: string | null };
