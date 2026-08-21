# Legacy judoka editorial review

This review covers every record migrated from the legacy `judoka.json`. It was completed on 2026-08-14 and updated for the multi-technique model on 2026-08-21. `signatureMoveIds`, stats, and rarity are shared editorial attributes rather than claims of an official athlete record. Every legacy scalar signature move was migrated to the required, non-empty array without changing its technique association.

## Catalogue decision

Identifiable fictional judo characters may remain in the canonical catalogue for games that opt into them. They must use `personType: "fictional"` and remain hidden by default. Consumers can therefore select real, visible people with `personType === "real" && !isHidden`. Unverifiable filler identities are excluded rather than presented as people or characters.

For fictional entries, `countryCode` describes the character's documented national or narrative association; it does not claim citizenship. Weight and signature move are deliberate gameplay classifications when no competition record can exist.

## Record audit

| Legacy identity | Decision and identity | Country / weight | Signature move | Profile and visibility |
| --- | --- | --- | --- | --- |
| Askley McKenzie | Corrected to **Ashley McKenzie**; historic display name retained in `aliases` and old URL handle in `legacySlugs`. | Jamaica (`JM`), men's -60 kg, reflecting his current sporting representation and established division. | `seoi-nage` retained as an editorial characterization. | [Ashley McKenzie](https://en.wikipedia.org/wiki/Ashley_McKenzie); real and visible. |
| Ilia Sulamanidize | Corrected to **Ilia Sulamanidze**; historic display name retained in `aliases` and old URL handle in `legacySlugs`. | Georgia (`GE`), men's -100 kg. | `uchi-mata` retained as an editorial characterization. | [Ilia Sulamanidze](https://en.wikipedia.org/wiki/Ilia_Sulamanidze); real and visible. |
| Joana Ramos | Name confirmed. | Portugal (`PT`), women's -52 kg. | `uchi-mata` retained as an editorial characterization. | [Joana Ramos](https://en.wikipedia.org/wiki/Joana_Ramos); real and visible. |
| Leilani Akiyama | Excluded: the name and athlete could not be substantiated, and the purported profile does not identify a judoka. The immutable UUID remains in the legacy ID map so consumers can retire the record safely. | Removed rather than publishing unverified US / -57 kg claims. | Removed rather than publishing an unsupported `uchi-mata` association. | Former `https://en.wikipedia.org/wiki/Leilani_Akiyama` reference rejected; not canonical. |
| Mystery Judoka | Retained as the intentionally unnamed fictional mentor in *Judo Boy*, not as a real person. | Bhutan (`BT`) as narrative association; men's +100 kg is a gameplay classification. | `ura-nage` retained as a gameplay classification. | [Judo Boy](https://en.wikipedia.org/wiki/Judo_Boy); fictional and hidden. |
| Nina Cutro-Kelly | Name confirmed. | United States (`US`), women's +78 kg. | `o-soto-gari` retained as an editorial characterization. | [Nina Cutro-Kelly](https://en.wikipedia.org/wiki/Nina_Cutro-Kelly); real and visible. |
| Shōzō Fujii | Diacritics and canonical ASCII slug confirmed; diacritic-free **Shozo Fujii** retained as a display alias. | Japan (`JP`), men's -81 kg as the modern catalogue mapping for his historical divisions. | `seoi-nage` retained as an editorial characterization. | [Shōzō Fujii](https://en.wikipedia.org/wiki/Sh%C5%8Dz%C5%8D_Fujii); real and visible. |
| Tatsuuma Ushiyama | Retained as a fictional *Golden Kamuy* character. The spelling is confirmed; the legacy Vanuatu association was corrected. | Japan (`JP`), with men's +100 kg as a gameplay classification. | `ura-nage` retained as a gameplay classification. | [Tatsuuma Ushiyama](https://goldenkamuy.fandom.com/wiki/Tatsuuma_Ushiyama); fictional and hidden. |

All generic migrated biographies were replaced with concise record-specific editorial copy. Placeholder prose such as `More info to come...` remains invalid under canonical validation.
