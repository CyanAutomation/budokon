# Legacy judoka editorial review

This ledger records the review of every record migrated from `judoka.json` on
2026-08-14. A profile is a source for identity and career, not evidence that a
catalogue gameplay value is an athlete's objectively documented favourite.
Accordingly, **signature move** below means the reviewed editorial assignment.
Country and weight use current catalogue codes and divisions.

| Canonical identity | Type / default visibility | Profile review | Country / weight | Signature move review |
| --- | --- | --- | --- | --- |
| Ashley McKenzie | real / visible | Corrected `Askley`; Wikipedia profile agrees with the corrected identity. | Jamaica (`JM`) / men's -60 kg; reflects his later international representation and division. | `seoi-nage`, retained as an editorial assignment. |
| Ilia Sulamanidze | real / visible | Corrected `Sulamanidize`; Wikipedia profile agrees with the corrected identity. | Georgia (`GE`) / men's -100 kg, verified division. | `uchi-mata`, retained as an editorial assignment. |
| Joana Ramos | real / visible | Wikipedia profile agrees with the identity. | Portugal (`PT`) / women's -52 kg, verified division. | `uchi-mata`, retained as an editorial assignment. |
| Nina Cutro-Kelly | real / visible | Wikipedia profile agrees with the identity. | United States (`US`) / women's +78 kg, verified division. | `o-soto-gari`, retained as an editorial assignment. |
| Shōzō Fujii | real / visible | Wikipedia profile agrees with the identity and diacritics. | Japan (`JP`) / men's -81 kg; a modern catalogue class representing his middleweight career. | `seoi-nage`, retained as an editorial assignment. |
| Leilani Akiyama | fictional / hidden | No reliable profile or real athlete identity was established; the broken Wikipedia claim was removed and the biography is `null`. | United States (`US`) / women's -57 kg are explicitly legacy catalogue classifications, not biographical claims. | `uchi-mata`, retained as a legacy fictional assignment. |
| Mystery Judoka | fictional / hidden | Not a factual personal identity; the linked *Judo Boy* page identifies only the source inspiration. | Japan (`JP`) identifies the source work (correcting unsupported Bhutan); men's +100 kg is a legacy catalogue classification. | `ura-nage`, retained as a legacy fictional assignment. |
| Tatsuuma Ushiyama | fictional / hidden | The Golden Kamuy character profile agrees with the spelling and fictional identity. | Vanuatu (`VU`) / men's +100 kg are legacy catalogue classifications, not canonical character biography. | `ura-nage`, retained as a legacy fictional assignment. |

## Inclusion decision

Identifiable fictional judoka are retained for backwards compatibility with
consumer saves, but they are not ordinary canonical people: `personType` makes
the distinction machine-readable and every fictional record is hidden. New
consumers should default to `personType === "real" && !isHidden`. An unverifiable
profile or biography is nullable; placeholder or generic catalogue prose is not
acceptable editorial content.
