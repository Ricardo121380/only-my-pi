# Third-party notices

only-my-pi is an independent project. It is not affiliated with or endorsed by
the Pi coding agent or extension authors.

The table below describes the historical `0.2.0-preview.1` distribution. It is
not the dependency inventory of the current development branch. Current source
dependencies are pinned by `package.json` and `package-lock.json`; a new binary
distribution requires notices and license texts for its own exact release tree.
Private material-candidate records do not grant permission to redistribute the
referenced material. See the [public source projection record](docs/maintenance/2026-10-19-public-source-projection.md).

The `0.2.0-preview.1` distribution includes or provisions the following direct
components at exact versions. Their package manifests declare the MIT license:

| Component | Version | Relationship |
| --- | --- | --- |
| Node.js | 24.19.0 darwin-arm64 | embedded runtime; MIT plus Node bundled third-party notices |
| `@earendil-works/pi-coding-agent` | 0.84.3 | controlled user-local Pi runtime |
| `@narumitw/pi-plan-mode` | 0.55.2 | external, user-owned Pi package |
| `pi-agent-extensions` | 0.5.4 | external, user-owned Pi package |
| `pi-web-access` | 0.25.0 | external, user-owned Pi package |
| `pi-subagents` | 0.57.0 | external, user-owned Pi package |
| `pi-permission-modes` | 2.2.0 | external, user-owned Pi package |
| `@narumitw/pi-lsp` | 0.49.6 | external, user-owned Pi package |
| `@sreetej510/pi-usage` | 0.7.1 | external, user-owned Pi package |
| `pi-memory` | 0.4.1 | external, user-owned Pi package; disabled by default |
| `pi-git-sync` | 0.1.3 | external, user-owned Pi package; disabled by default |

This repository notice is a human-readable direct-component summary. Each
release generates a complete `transitive-artifact-ledger-v1`, SPDX 2.3 SBOM,
`THIRD_PARTY_NOTICES.txt`, and `LICENSES/` directory from the exact verified
release tree. Those release artifacts, rather than this summary, are the
authority for the complete transitive package set and checksums.

No dependency lifecycle script is executed while constructing or applying the
public distribution. License texts remain the property of their respective
copyright holders and are reproduced under their terms.

## yaml 2.9.0

The shared product settings import parser uses the existing pinned YAML parser as an explicit bundled runtime dependency. Source: https://registry.npmjs.org/yaml/2.9.0 . The package and its ISC license remain included under `node_modules/yaml/`.

```text
Copyright Eemeli Aro <eemeli@gmail.com>

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```
