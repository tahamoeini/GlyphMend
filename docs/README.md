# GlyphMend documentation

These guides describe the behavior and workflows represented by the current repository. The root [README](../README.md) is the product overview and quick start. For live CI and release status, check the corresponding GitHub Actions run and Releases page; workflow definitions and Git tags do not prove that a run succeeded or that an artifact was published.

| Guide | Use it for |
| --- | --- |
| [Browser operations](browser.md) | Local processing, OCR settings, checkpoints, deployment, and troubleshooting. |
| [Browser application](../web-app/README.md) | Browser features, build commands, exports, and licensing. |
| [Companion workspace](../companion/README.md) | Rust workspace structure and local CLI development. |
| [Companion engine and API](companion-engine.md) | Pairing, loopback API, request limits, fallback, and portable packages. |
| [GlyphMend Desktop](desktop.md) | Tauri host, runtime resources, package targets, and local development. |
| [CI/CD and releases](ci.md) | Manual workflows, local checks, version updates, and release procedures. |
| [Compliance and data handling](compliance.md) | Project licenses, dependency checks, release notices, and document data paths. |
| [Distribution status](distribution-plan.md) | Configured targets and remaining release evidence. |
| [Architecture](architecture.md) | Product boundaries, data flow, and repository layout. |
| [Branding](branding.md) | Canonical brand configuration and generated browser assets. |
| [Roadmap](roadmap.md) | Implemented capabilities and outstanding validation. |
| [Historical UI redesign notes](STITCH_UI_CONTRACT.md) | Archived Stitch redesign decisions and their original acceptance notes. |
| [Archive index](archive/README.md) | Historical upgrade records. |

The Browser/PWA is complete without a Companion. Users can optionally select the standalone Companion for a job or install Desktop, which uses the same Rust extraction service through Tauri IPC.
