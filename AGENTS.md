# ren-dom

Standing rules for agents working in this checkout.

Read the workspace layer first: [`../../../AGENTS.md`](https://github.com/wiltonlazary/rui/blob/main/AGENTS.md) and [`../../../.ai/config/`](https://github.com/wiltonlazary/rui/tree/main/.ai/config)
(stability.md first, then javascript.md, design.md, benchmarks.md, concepts.md,
resources.md, git.md).
Then read [README.md](README.md), ren-core's README for the component layer and
the Host contract ([`../../../ren-core/wtree/_repo_/README.md`](https://github.com/wiltonlazary/ren-core)),
[ren-bench's market README](https://github.com/wiltonlazary/ren-bench/blob/main/bench/market/README.md) for the market table, and
[TODO.md](TODO.md) for open work.

## What this is

ren-dom is ren-core's DOM renderer, a production library packaged as
`ren-dom`: the `$dom` (light DOM) and `$shadow` (shadow root) hosts,
event delegation and compiled-template cloning. ren-bench owns the DOM market benchmark.
Its one runtime dependency is ren-core, linked from [`../../../ren-core/wtree/_repo_`](https://github.com/wiltonlazary/ren-core);
rrx-core comes through ren-core (and is linked as a devDependency for the tests).

## Layout and outputs

- Checkout: `wtree/_repo_` (branch `main`); feature branches are sibling
  worktrees under `wtree/<name>`, each with its own build directory
  `build/<name>_<version>` and its own `artifact` link to it.
- Build output: `build/_repo__0.1.2`, reached through the ignored `artifact`
  link for library scratch (`artifact/tmp/<task>/`). Benchmark bundles,
  Chrome profiles and recorded readings belong to ren-bench.
- `types/` is generated (`scripts/types.mjs`) and ignored.

## Project specifics

- ren-dom consumes ren-core's public entries only (`ren-core`, `ren-core/host`,
  `ren-core/worker`, `ren-core/remote`, `ren-core/esbuild`). When it needs something new
  from ren-core (a Host member, a `mount` option), change ren-core first, with ren-core's
  tests, then this package; both suites must pass.
- Install rrx-core, then ren-core, then ren-canv, then this package: `tsc`
  reads their generated declarations, and the layout tests use ren-canv's
  Flow.
- The TypeScript consumers in `test/types/` compile with
  `jsxImportSource: "ren-core"`.
- The market runner lives in ren-bench and takes the machine-wide Chrome
  lock. Compare against its recorded readings only with the same method.
