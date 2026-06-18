# Open-Source & Dependency Policy

This document records how Beacon is licensed, how inbound contributions are licensed, and which
third-party dependency licenses are allowed. It exists so the project stays clean for both community
distribution and any future commercial edition or acquisition — unmanaged copyleft dependencies and
the *absence* of a written policy are two of the most common red flags in software M&A due diligence.

## Project license

- Beacon's first-party source is licensed under the **Apache License 2.0** (see [`LICENSE`](./LICENSE)
  and [`NOTICE`](./NOTICE)).
- Apache 2.0 is chosen over MIT for its explicit **patent grant**, which enterprises and acquirers
  prefer.

## Inbound contribution license

- All contributions are accepted under Apache 2.0 **and** require a signed
  [Contributor License Agreement](./CLA.md) (enforced by CLA Assistant on every PR).
- The CLA grants the project the right to **relicense or sublicense** contributions (including under a
  proprietary commercial license) and to transfer those rights. This preserves the option to ship a
  paid edition or sell the project as a whole without having to track down every past contributor.

## Dependency license rules

| Tier | Licenses | Rule |
|------|----------|------|
| **Allowed** | MIT, ISC, Apache-2.0, BSD-2/3-Clause, 0BSD, Unlicense, BlueOak-1.0.0, CC0, Python-2.0 | Use freely. |
| **Review** | MPL-2.0, LGPL-2.1/3.0, CDDL, EPL | Allowed **only** when dynamically linked / kept as a separate file, never statically vendored into our source. Note it here. |
| **Forbidden** | GPL (any), AGPL (any), SSPL, BUSL/BSL, Elastic License, CC-BY-SA (in code), OSL | Do **not** add. These can force source disclosure ("taint") or are explicitly banned by many enterprises and acquirers. |

**Rule for the future paid "intelligence layer":** it must live in a **separate, private repository**
(not a directory of this public repo) and must not pull any "Forbidden"-tier dependency. Keeping the
proprietary layer architecturally separate keeps it unencumbered and cleanly sellable.

## Current audit snapshot

Production dependency tree (run `npx license-checker-rseidelsohn --production --summary`):

- 550 MIT · 42 ISC · 31 Apache-2.0 · 11 BSD-3-Clause · 4 BSD-2-Clause · plus 0BSD, Unlicense,
  BlueOak, CC0, Python-2.0, CC-BY-4.0 — all **Allowed**.
- **1 "Review" tier:** `@img/sharp-libvips-darwin-arm64` (LGPL-3.0-or-later) — a transitive,
  prebuilt **native binary** of libvips pulled in by `sharp`/Next.js image optimization. It is
  **dynamically loaded as a separate platform binary**, which LGPL expressly permits with **no source
  obligations on Beacon's own code**. This is the standard, well-understood `sharp` situation and is
  acceptable.
- **0 "Forbidden" tier:** no GPL, AGPL, SSPL, BSL, or Elastic-licensed dependencies. ✅

## Re-running the audit

```bash
npx license-checker-rseidelsohn --production --summary
# flag anything copyleft / source-available:
npx license-checker-rseidelsohn --production --csv | grep -iE "GPL|AGPL|SSPL|BSL|BUSL|Elastic|CDDL|EPL|OSL"
```

CI runs a secret scan (gitleaks) on every PR; the dependency audit should be re-run before any
release and before any acquisition due-diligence handoff.
