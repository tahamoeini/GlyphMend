# GlyphMend documentation

The repository has one shared web interface and one Rust processing service. Users can choose one of three paths:

1. **Browser only:** use the hosted or locally built web app; no Companion process is required.
2. **Browser with the local engine:** launch the installed GlyphMend app in headless Companion mode. It runs the loopback service and opens the browser interface for pairing.
3. **Installed Desktop app:** use the same web interface inside Tauri with the bundled Rust engine through IPC.

There is no separately distributed Companion installer. The headless engine and Desktop interface are modes of the same installed GlyphMend app. The Companion CLI source remains for development and benchmarks; it is not the user-facing product.

## Guides

| Guide | Use it for |
| --- | --- |
| [Browser operations](browser.md) | Browser-only use, local data, extraction settings, deployment, and troubleshooting. |
| [Browser application](../web-app/README.md) | Frontend development, builds, exports, and license reporting. |
| [Companion workspace](../companion/README.md) | Rust service and bridge development, including headless Desktop mode. |
| [Companion engine and API](companion-engine.md) | Loopback pairing, security boundaries, protocol, capability reporting, and fallback. |
| [GlyphMend Desktop](desktop.md) | Installed app, headless mode, native resources, development, and package targets. |
| [CI/CD and releases](ci.md) | Manually dispatched quick checks, full validation, benchmarks, release versioning, and artifacts. |
| [Compliance and data handling](compliance.md) | Licenses, dependency notices, local document handling, and distribution controls. |
| [Distribution status](distribution-plan.md) | Current outputs and release gates. |
| [Architecture](architecture.md) | Shared interface, providers, processing core, and repository layout. |
| [Branding](branding.md) | Canonical brand configuration and generated assets. |
| [Roadmap](roadmap.md) | Implemented behavior and outstanding verification. |
| [Historical UI redesign record](STITCH_UI_CONTRACT.md) | Archived redesign decisions; not a current product specification. |
| [Documentation archive](archive/README.md) | Historical upgrade records that are not authoritative for current behavior. |

## Source of truth

Use the current code and guides above for active product behavior. Archived plans, benchmark notes, and design records preserve history and must not be used as current implementation instructions. Workflow files describe what can be run; inspect the linked Actions run for evidence that a revision actually passed.
