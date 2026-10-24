---
name: jev-advisory
description: Use when the user asks to evaluate or interpret JEV semantic search, query interpretation, proposed-judoka review, or playstyle recommendations.
---

# JEV advisory work

JEV provides bounded semantic review signals. It is optional and internal-only.
Read the [JEV guide](../../../docs/JEV.md) before using it.

## Evidence and authority

- Treat every model response as an advisory signal, not a fact or approval.
  Deterministic validation, code, and human editorial review remain authoritative.
- A source URL without supplied source excerpts is not evidence. JEV does not
  fetch URLs; use only the excerpts available for the requested review.
- Keep factual identity claims separate from editorial ratings, rarity, and
  signature techniques. A low-confidence or abstaining response is not a value
  to write into canonical data.
- Never use JEV to choose draws, calculate game outcomes, decide releases, or
  write or commit canonical records.
- Keep provider keys in secret storage. Never print, commit, or request a key
  value in chat or source files.

## Evaluations

- The live **npm run jev:evaluate** and **npm run jev:evaluate:playstyle**
  commands call the configured OpenRouter provider and require
  JEV_OPENROUTER_API_KEY. Run them only when the user requests a live
  evaluation; do not silently incur provider usage.
- **npm run check** runs the offline repository suite and fake-client JEV tests.
  It does not call OpenRouter.
- Evaluation fixtures are small and non-gating. Report their scope and do not
  generalize synthetic examples into claims about real athletes.
- Accepted playstyle facets must be reviewed and explicitly added by a human.
  The canonical schema rejects unsupported values and insufficient_evidence.
