🥋 BU-DO-KON

Canonical content repository for JU-DO-KON!

BU-DO-KON contains the structured, version-controlled source data for all official JU-DO-KON! judoka cards. It is the single editorial source of truth for card definitions, stats, and metadata.

This repository contains data only — it does not contain a runtime API.

⸻

🎴 Purpose

BU-DO-KON exists to:
	•	Maintain a clean, version-controlled card dataset
	•	Allow structured review of stat changes via pull requests
	•	Provide deterministic deck versions
	•	Enable controlled syncing into the JU-DO-KON Game API
	•	Separate content from engine logic

Think of this repository as the card design studio, not the game server.

⸻

🧱 Architecture Context

flowchart LR
    A[BU-DO-KON Repo<br/>judoka.json] -->|Manual Sync| B[JU-DO-KON Game API]
    B --> C[Postgres Database]
    C --> D[Client UI]

	•	BU-DO-KON → canonical content
	•	Game API → runtime authority
	•	Postgres → operational store
	•	Client → presentation layer

⸻

📂 Repository Structure

.
├── judoka.json
├── schema/
│   └── judoka.schema.json
├── README.md
└── LICENSE

judoka.json

The complete structured deck definition.

This file defines:
	•	Core gameplay attributes
	•	Signature moves
	•	Structured metadata
	•	Expansion tags (if applicable)

⸻

🧩 Data Model Philosophy

Each judoka consists of:

🔒 Structured Core (Gameplay Critical)

These fields must remain valid and constrained:
	•	id
	•	code
	•	firstName
	•	surname
	•	country
	•	weightClass
	•	rarity
	•	stats (0–10 scale)
	•	signatureMove

These are enforced by:
	•	JSON schema validation
	•	Database constraints during sync

⸻

📦 Metadata (Extensible)

The metadata object may contain:
	•	Competitive achievements
	•	Expansion identifiers
	•	Visual configuration hints
	•	AI balancing hints
	•	Lore / biography text
	•	Internal content versioning

Metadata must never affect core match engine logic.

⸻

🏷 Versioning Strategy

This repository follows:
	•	Git-based semantic versioning
	•	Tagged deck releases (e.g. v1.0.0)
	•	PR-based stat review
	•	Change log discipline

Deck versions can be referenced by the JU-DO-KON Game API during sync.

⸻

🔄 Syncing to JU-DO-KON

This repository does not expose an HTTP API.

The JU-DO-KON Game API:
	1.	Fetches judoka.json
	2.	Validates against judoka.schema.json
	3.	Performs transactional database sync
	4.	Applies relational constraints
	5.	Logs deck version and commit hash

Sync is manual or admin-triggered.

⸻

🧪 Validation

All changes to judoka.json must:
	•	Pass JSON schema validation
	•	Maintain stat bounds (0–10)
	•	Preserve unique code values
	•	Respect rarity enum values

Validation may be enforced via GitHub Actions.

⸻

🛡 Governance Principles

BU-DO-KON adheres to:
	•	Deterministic content
	•	Explicit review of stat changes
	•	Clear separation of content and engine
	•	Reproducible deck builds
	•	Auditability via Git history

⸻

🚀 Future Expansion

Planned capabilities may include:
	•	Seasonal deck branches
	•	Expansion sets
	•	Rotation eligibility flags
	•	Balance adjustments
	•	Content experiments

BU-DO-KON remains content-only by design.

⸻
