# GlyphMend branding configuration

GlyphMend keeps product identity separate from extraction behavior. The canonical source configuration is [`../branding.json`](../branding.json).

The browser build runs `npm run brand:sync` before development, tests, previews, and production builds. That copies the configured runtime branding and logo into `web-app/public/` and regenerates the PWA manifest.

The browser loads branding.json at runtime. A deployment can replace that file and the referenced logo to change the visible product name, slogan, and logo without rebuilding extraction code. The browser sets page metadata and the PWA description from the slogan; the current build does not use the separate description field. PWA install metadata is generated at build/sync time, so rerun brand sync and rebuild when install metadata or the install icon needs to change.

The sync script requires non-empty name, shortName, slug, cliName, slogan, and logoPath values. The source logo must resolve to a file inside the repository's brand/ directory. It copies that logo into the browser's public assets and regenerates the public branding file and PWA manifest. Keep generated public files in sync by running `npm run brand:sync` from the repository root after editing the source configuration or logo.

Brand configuration does not affect extraction fingerprints or invalidate saved checkpoints. The Rust Companion identifies itself as GlyphMend Companion and reports its own engine version in Semantic Document IR v2.
