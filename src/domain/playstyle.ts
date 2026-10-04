/** Bounded playstyle values shared by the advisory classifier and approved catalogue data. */
export const PLAYSTYLE_OPTIONS = {
  tacticalStyle: ["pressure", "counter", "balanced", "insufficient_evidence"],
  tempo: ["patient", "balanced", "aggressive", "insufficient_evidence"],
  gripStyle: ["dominant", "adaptive", "defensive", "mixed", "insufficient_evidence"],
  newazaEmphasis: ["low", "medium", "high", "insufficient_evidence"],
  standingPreference: [
    "ashi_waza",
    "te_waza",
    "koshi_waza",
    "ma_sutemi_waza",
    "yoko_sutemi_waza",
    "mixed",
    "insufficient_evidence",
  ],
} as const;

export type PlaystyleFacet = keyof typeof PLAYSTYLE_OPTIONS;
export type PlaystyleOption<F extends PlaystyleFacet> = (typeof PLAYSTYLE_OPTIONS)[F][number];
export type ApprovedPlaystyleOption<F extends PlaystyleFacet> = Exclude<PlaystyleOption<F>, "insufficient_evidence">;

/** Optional editorial metadata. Each included facet must have been explicitly approved by a human. */
export interface ApprovedJudokaPlaystyle {
  tacticalStyle?: ApprovedPlaystyleOption<"tacticalStyle">;
  tempo?: ApprovedPlaystyleOption<"tempo">;
  gripStyle?: ApprovedPlaystyleOption<"gripStyle">;
  newazaEmphasis?: ApprovedPlaystyleOption<"newazaEmphasis">;
  standingPreference?: ApprovedPlaystyleOption<"standingPreference">;
}
