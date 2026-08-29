export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface Judoka {
  id: string;
  slug: string;
  firstname?: string;
  surname?: string;
  aliases?: string[];
  legacySlugs?: string[];
  countryCode?: string;
  gender?: string;
  weightClass?: string;
  rarity?: string;
  sourceUrls?: string[];
  personType?: string;
  signatureMoveIds: string[];
  isHidden?: boolean;
  [key: string]: JsonValue | undefined;
}

export interface Technique { id: string; [key: string]: JsonValue; }
export type EventAction = "modify" | "set";
export type EventTarget = "power" | "speed" | "technique" | "kumikata" | "newaza" | "shido" | "waza_ari" | "score" | "match_result";
export interface EventEffect { action: EventAction; target: EventTarget; value: number | string; }
/** A ruleset-scoped gameplay prompt. Consumers apply effects to their own match state. */
export interface JudoEvent { id: string; ruleset: string; category: string; description: string; effects: EventEffect[]; }
export interface Country { code: string; country: string; active: boolean; [key: string]: JsonValue; }
export interface WeightCategoryGroup { gender: string; categories: JsonValue[]; [key: string]: JsonValue; }

export interface ReleaseManifest {
  datasetVersion: string;
  serviceVersion: string;
  drawAlgorithms: string[];
  defaultDrawAlgorithm: string;
  sourceGitCommit: string;
  checksums: Record<string, string>;
  [key: string]: JsonValue;
}

/** The immutable aggregate emitted by the data compiler and suitable for bundling. */
export interface CompiledDataset {
  datasetVersion: string;
  judoka: Judoka[];
  techniques: Technique[];
  events?: JudoEvent[];
  countries: Record<string, Country>;
  weightCategories: WeightCategoryGroup[];
  /** Optional deployment metadata; it is deliberately not embedded in budokon.json. */
  manifest?: ReleaseManifest;
}

export type FilterField = "countryCode" | "gender" | "weightClass" | "rarity" | "personType" | "signatureMoveIds";
export type Filters = Partial<Record<FilterField, string | string[]>>;
export interface VisibilityOptions { includeHidden?: boolean; authorizedInternal?: boolean; }
export interface ListJudokaOptions extends VisibilityOptions { filters?: Filters; exclude?: string[]; }
export interface SearchJudokaOptions extends ListJudokaOptions { query?: string; q?: string; }
export interface DrawRequest extends ListJudokaOptions { count?: number; seed?: string; algorithm?: string; }
export interface RequestContext { authorizedInternal?: boolean; }
export interface DrawResponse { datasetVersion: string; algorithm: string; seed?: string; poolSize: number; judoka: Judoka[]; }
export interface EventDrawRequest { ruleset: string; category?: string; seed?: string; exclude?: string[]; }
export interface EventDrawResponse { datasetVersion: string; algorithm: string; seed?: string; poolSize: number; event: JudoEvent; }
export interface VersionResponse {
  datasetVersion: string;
  serviceVersion: string;
  drawAlgorithms: string[];
  defaultDrawAlgorithm: string;
  sourceGitCommit: string;
  datasetChecksum: string;
}
export interface StatusResponse extends VersionResponse { status: "ok"; }
export interface CoverageResponse {
  total: number;
  publicReal: number;
  hidden: number;
  byGender: Record<string, number>;
  byCountry: Record<string, number>;
  byWeightClass: Record<string, number>;
  byRarity: Record<string, number>;
  rarityPercentages: Record<string, number>;
}
