---
url: /protocols/README.md
---
# Protocol Documentation Guidelines

Rules for maintaining consistent, navigable protocol specifications.

## Document Pattern

Every protocol MUST have:

| Document                                       | Purpose                                              | Authority                  |
| ---------------------------------------------- | ---------------------------------------------------- | -------------------------- |
| `index.md`                                     | Overview, delegation, authority table, reading order | Navigation (non-normative) |
| `wire-format.md` or `cryptography-and-wire.md` | Binary encoding, frame structure                     | Primary                    |
| `behavior.md` or `state-machine.md`            | Runtime semantics, state transitions                 | Primary                    |
| `conformance.md`                               | Test vectors, validation checklist                   | Supporting                 |

Optional: `errors.md` (if not delegated), security appendices, extension stubs.

## Authority Banners

Every document MUST start with:

```markdown
# Document Title

> **Authority**: Primary (Normative) | Supporting (Reference) | Navigation (Non-normative)
> **Purpose**: One-line description of what this document defines.
```

Use two spaces at the end of a line to create a line break in Markdown.

## Authority Rules

1. **Primary**: Defines canonical rules. Source of truth. Uses MUST/SHOULD/MAY.
2. **Supporting**: References and elaborates. MUST NOT redefine primary content.
3. **Navigation**: Index files only. MUST NOT contain RFC 2119 keywords.

**Conflict resolution**:

* Same protocol: Primary wins over Supporting
* Cross-protocol: `architecture.md` governs layer boundaries; lower layer wins
* Unresolved: File an issue; do not ship conflicting specs

## Index File Requirements

Each protocol's `index.md` MUST include:

1. **Authority banner** (Navigation, non-normative)
2. **Delegation section** — what is inherited vs defined locally
3. **Document Authority table** — maps concerns to Primary/Supporting docs
4. **Recommended Reading Order** — numbered list for implementers

Example delegation:

```markdown
## Delegation

This protocol delegates:

- **Wire format**: Inherits SBP frame structure (see sbp/wire-format.md)
- **Error codes**: Reuses SBP errors (1000-1999)

This protocol defines:

- **Envelope format**: See envelope.md
```

## Terminology

* Define protocol-scoped terms in `index.md` → Local Terminology section
* Link to `glossary.md` for cross-protocol terms
* Never redefine glossary terms locally

## Stub Documents

Mark incomplete documents:

```markdown
> **Status: Stub** — This document is non-authoritative until content is added.
```

Stubs MUST NOT contain RFC 2119 keywords (MUST/SHOULD/MAY).

## Content Rules

1. **No duplication**: Define once, reference elsewhere
2. **Clear scope**: Each document has one focused purpose
3. **Cross-references**: Use relative links `[text](./file.md)`
4. **Code examples**: Keep in normative docs, not index files
5. **Diagrams**: Mermaid for sequences, ASCII for frame layouts

## Validation Checklist

Before merging protocol changes, verify:

* \[ ] All documents have authority banners with purpose line
* \[ ] Index files have delegation + authority table + reading order
* \[ ] Index files contain no RFC 2119 keywords
* \[ ] New terms added to glossary.md or Local Terminology
* \[ ] Cross-references use relative paths and resolve correctly
* \[ ] Stubs marked with status banner
* \[ ] No normative content duplicated across documents

## File Structure

```
docs/protocols/
├── README.md           # This file (guidelines)
├── index.md            # Protocol hub + pattern declaration
├── glossary.md         # Shared terminology
├── architecture.md     # Layer boundaries (Primary)
├── <protocol>/
│   ├── index.md        # Navigation + delegation
│   ├── *.md            # Normative/supporting docs
```
