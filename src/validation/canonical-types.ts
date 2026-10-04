export interface ParsedFile<T> { name: string; value: T; }

export interface LoadedCanonicalData {
  schemas: {
    judoka: unknown;
    technique: unknown;
    event: unknown;
    countries: unknown;
    weights: unknown;
    dataset: unknown;
  };
  judokaFiles: ParsedFile<unknown>[];
  techniqueFiles: ParsedFile<unknown>[];
  eventFiles: ParsedFile<unknown>[];
  countries: unknown;
  weights: unknown;
  dataset: unknown;
}

export interface ValidatedCanonicalData {
  judokaFiles: ParsedFile<CanonicalJudoka>[];
  techniqueFiles: ParsedFile<CanonicalTechnique>[];
  eventFiles: ParsedFile<CanonicalEvent>[];
  countries: CanonicalCountries;
  weights: CanonicalWeightGroup[];
  dataset: CanonicalDataset;
}

export interface CanonicalCountry { code: string; country: string; active: boolean; lastUpdated: string; }
export type CanonicalCountries = Record<string, CanonicalCountry>;
export interface CanonicalPlaystyle {
  tacticalStyle?: "pressure" | "counter" | "balanced";
  tempo?: "patient" | "balanced" | "aggressive";
  gripStyle?: "dominant" | "adaptive" | "defensive" | "mixed";
  newazaEmphasis?: "low" | "medium" | "high";
  standingPreference?: "ashi_waza" | "te_waza" | "koshi_waza" | "ma_sutemi_waza" | "yoko_sutemi_waza" | "mixed";
}
export interface CanonicalJudoka {
  id: string; slug: string; legacySlugs?: string[]; firstname: string; surname: string;
  aliases?: string[]; personType: string; isHidden?: boolean; countryCode: string;
  signatureMoveIds: string[]; gender: string; weightClass: string; lastUpdated: string; bio: string;
  playstyle?: CanonicalPlaystyle;
  sources?: Array<{ checkedAt: string }>;
}
export interface CanonicalTechnique { id: string; slug?: string; name: string; japanese: string; description: string; }
export interface CanonicalEffect { action: string; target: string; value: unknown; }
export interface CanonicalEvent { id: string; slug?: string; description: string; effects: CanonicalEffect[]; }
export interface CanonicalWeightCategory { weight: string; descriptor: string; }
export interface CanonicalWeightGroup { gender: string; description: string; categories: CanonicalWeightCategory[]; }
export interface CanonicalDataset { datasetVersion: string; }
