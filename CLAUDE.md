# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A reusable filter library for Webflow backed by Algolia. Designed to bypass Webflow CMS's 100-item render cap by syncing the entire collection to Algolia and rendering results from a single `<template>` element via `data-*` attributes — similar in spirit to Finsweet Attributes.

The repo on disk is also the **GitHub template repo** (`felixeallan/algolia-webflow-filter`) that end users fork. The built library file is served from this repo via jsDelivr — the public CDN URL points at a version tag (e.g. `@v0.3.5`) on this repo, so **a new library release is a git tag, not an npm publish.**

A separate test repo (`felixeallan/algolia-webflow-test-1`) is kept in sync by force-pushing the same commits — when reasoning about deploys, assume both exist.

## Repo layout (npm workspaces)

Three independently-deployed pieces, all in one monorepo:

- [apps/sync/](apps/sync/) — Next.js app deployed to **Webflow Cloud** (which runs on Cloudflare Workers). Owns `POST /api/sync` (full paginated re-sync, Bearer-protected) and `PUT /api/sync` (schema dump for debugging). Reads the Webflow CMS, resolves reference and option fields to human-readable names, and pushes the documents to Algolia via direct REST calls.
- [apps/webhook-worker/](apps/webhook-worker/) — Standalone Cloudflare Worker (vanilla JS, no framework). Receives Webflow CMS webhooks and does per-item upserts/deletes against Algolia; on `site_publish` it calls back into the sync app to trigger a full re-sync. Lives separately because Webflow refuses to send webhooks to `*.webflow.io` hostnames, so the Webflow Cloud app can't receive them directly.
- [packages/library/](packages/library/) — The browser library. TypeScript bundled with esbuild to a single minified IIFE at [packages/library/dist/algolia-webflow.min.js](packages/library/dist/algolia-webflow.min.js). The entire runtime is in [packages/library/src/index.ts](packages/library/src/index.ts) — read it as one file, not as a collection of modules.

The legacy [apps/sync/src/app/webhook/route.ts](apps/sync/src/app/webhook/route.ts) exists but is unused in production — the Cloudflare Worker handles webhooks instead.

## Common commands

From repo root:
- `npm run build:library` — bundle the client library to `dist/`
- `npm run dev:sync` — run the Next.js sync app locally (vanilla `next dev`, **not** the Workers runtime)

From `packages/library/`:
- `npm run dev` — esbuild watch mode

From `apps/sync/`:
- `npm run build` — **must** use `next build --webpack` (the script already does this; do not switch to Turbopack, see below)
- `npm run preview` — `opennextjs-cloudflare build && opennextjs-cloudflare preview`

There is no test suite and no lint config.

### Reproducing Workers-runtime bugs locally

`next dev` does **not** catch the bugs that break in production, because production runs in the Cloudflare Workers runtime via OpenNext. To reproduce a real Worker crash:

```bash
export PATH="$HOME/.nvm/versions/node/v24.13.0/bin:$PATH"   # wrangler needs Node 24+
cd apps/sync
npx opennextjs-cloudflare build
npx wrangler dev --port 8799
curl localhost:8799/api/sync
```

Webflow Cloud surfaces Worker crashes as a generic "Internal Server Error" — this local harness is the only way to see the real stack trace.

## Webflow Cloud deployment constraints (load-bearing, non-obvious)

Several settings exist specifically because of how Webflow Cloud installs and runs the sync app. Don't undo them:

- **All build-time packages live under `dependencies`, not `devDependencies`** (typescript, @types/*, esbuild, @opennextjs/cloudflare, wrangler). Webflow Cloud installs with `npm install --omit=dev`, so anything in devDependencies is missing at build time. [apps/sync/package.json](apps/sync/package.json) reflects this.
- **Build with webpack, not Turbopack.** Next 16 defaults to Turbopack, whose dynamic-`require()` chunk loading throws `ChunkLoadError` at runtime in Workers and 500s every request. The `build` script pins `--webpack`.
- **Next.js is pinned to `~16.1.0`.** 16.2+ has a `prefetch-hints.json` loadManifest crash on Workers (opennext issue #1157).
- **Routes live directly under [apps/sync/src/app/](apps/sync/src/app/) (e.g. `sync/route.ts`, `webhook/route.ts`), not under `app/api/`.** The Webflow Cloud mount path is `/api`, which `next.config.js` already sets as `basePath` and `assetPrefix`. Putting routes under `app/api/` would produce doubled URLs like `/api/api/sync`.
- **Read env vars inside handlers (`process.env.X`), never at module top level.** Top-level reads execute at build time in Workers and won't see runtime secrets.
- Required Workers config files at app root: `open-next.config.ts`, `wrangler.jsonc`, `cloudflare-env.d.ts`, `webflow.json`, plus `next.config.js` with `basePath` and `assetPrefix` set to the mount path.

## Sync-app implementation notes

- The sync uses **direct Algolia REST API via `fetch`**, never the `algoliasearch` SDK. The SDK crashes inside Cloudflare Workers.
- Reference fields are flattened into both `field` (the referenced item's name) and `field__subfield` (all sub-fields of the referenced item) so the client can bind to e.g. `car-brand__logo.url`. See [apps/sync/src/app/sync/route.ts](apps/sync/src/app/sync/route.ts).
- Option fields are stored as the option's display name, not its internal ID.
- Webflow Switch (boolean) fields are stored as real `true`/`false`.
- The webhook worker is **vanilla JS** ([apps/webhook-worker/src/index.js](apps/webhook-worker/src/index.js)) deployed via copy-paste into the Cloudflare dashboard — not via wrangler from this repo. `wrangler.toml` is present but the production deploy path is manual paste, so edits to that file must also be reflected in the dashboard.

## Library implementation notes

- The library is a single IIFE bundle that reads `data-*` attributes from the DOM on `DOMContentLoaded` and wires up Algolia. There is no framework — direct DOM manipulation throughout [packages/library/src/index.ts](packages/library/src/index.ts).
- Public surface = the data attributes documented in [README.md](README.md). When changing or adding an attribute, update the README's "Data attribute reference" section in the same commit.
- **Faceting reminder:** any attribute used in `data-algolia-filter`, `data-algolia-filter-select`, or `data-algolia-range-*` must be added as a Facet in Algolia's index config. Missing facets fail silently (zero results).
- Boolean filter values are passed as the strings `"true"` / `"false"` in `data-algolia-value`.

## Release flow

1. Bump `packages/library/package.json` `version`.
2. Update the version tag referenced in [README.md](README.md)'s script-tag examples.
3. Run `npm run build:library` and commit the resulting `dist/algolia-webflow.min.js` — **the built file is committed** because jsDelivr serves it directly from the git tag.
4. Tag the commit `vX.Y.Z` and push the tag. The new version is live on jsDelivr within minutes.
5. Never advise users to pin to `@main` — jsDelivr caches branch URLs aggressively, leading to stale-script bugs. Always pin to a version tag.
