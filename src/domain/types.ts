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
  personType?: string;
  signatureMoveIds: string[];
  isHidden?: boolean;
  collections?: string[];
  [key: string]: JsonValue | undefined;
}

export interface Technique { id: string; [key: string]: JsonValue; }
export interface Collection { id: string; name: string; members: string[]; [key: string]: JsonValue | undefined; }
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
  countries: Record<string, Country>;
  weightCategories: WeightCategoryGroup[];
  collections: Collection[];
  /** Optional deployment metadata; it is deliberately not embedded in budokon.json. */
  manifest?: ReleaseManifest;
}

export type FilterField = "countryCode" | "gender" | "weightClass" | "rarity" | "personType" | "signatureMoveIds";
export type Filters = Partial<Record<FilterField, string | string[]>>;
export interface VisibilityOptions { includeHidden?: boolean; authorizedInternal?: boolean; }
export interface ListJudokaOptions extends VisibilityOptions { filters?: Filters; exclude?: string[]; collection?: string; }
export interface SearchJudokaOptions extends ListJudokaOptions { query?: string; q?: string; }
export interface DrawRequest extends ListJudokaOptions { count?: number; seed?: string; algorithm?: string; }
export interface RequestContext { authorizedInternal?: boolean; }
export interface DrawResponse { datasetVersion: string; algorithm: string; seed?: string; poolSize: number; judoka: Judoka[]; }
export interface VersionResponse {
  datasetVersion: string;
  serviceVersion: string;
  drawAlgorithms: string[];
  defaultDrawAlgorithm: string;
  sourceGitCommit: string;
  datasetChecksum: string;
}
export interface StatusResponse extends VersionResponse { status: "ok"; }
