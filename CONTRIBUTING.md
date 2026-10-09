# Contributing

Thanks for your interest in TypeScript Gateway. This is a small, dependency-free
project, and the rules below keep it that way. Please read this before opening a
pull request.

## Getting set up

You need **Node.js 20 or newer**. There are no other prerequisites.

```bash
git clone https://github.com/wicahma/typescript-gateway.git
cd typescript-gateway
npm install
```

Then verify the baseline before you change anything:

```bash
npm run typecheck     # strict tsc, must be clean
npm test              # full suite (vitest)
```

## Project principles

These are not preferences — changes that violate them will be asked to change:

- **Zero runtime dependencies.** The gateway runs on the Node.js standard
  library only. A new `dependencies` entry needs a very strong justification;
  dev-only tooling is fine.
- **No comments in source.** The code is expected to read on its own. Names and
  structure carry the intent; a comment that restates the code is noise.
- **Strict TypeScript.** `npm run typecheck` must pass with no errors and no
  suppressions (`@ts-ignore`, `any` escapes) added to get there.
- **Tests are the contract.** Behaviour that isn't covered by a test isn't done.

## Workflow (test-driven)

New behaviour starts with a failing test:

1. Write a test that describes the behaviour you want.
2. Run it and watch it fail for the right reason.
3. Write the smallest implementation that makes it pass.
4. Refactor with the test still green.
5. Run the whole suite — not just your file — before pushing.

```bash
npm test                      # all suites
npm run test:unit             # tests/unit
npm run test:integration      # tests/integration — real proxy/pipeline paths
npm run test:perf             # tests/performance — benchmark guards
```

Put unit tests in `tests/unit/`, end-to-end coverage in `tests/integration/`.
Timing-based assertions belong in `tests/performance/` or `benchmarks/`, and
must carry generous headroom — a shared CI runner is not a benchmark rig.

## Performance-sensitive changes

If a change touches the hot path (router, proxy handler, connection pool,
circuit breaker, cache), it must ship with a benchmark and evidence:

```bash
npm run benchmark           # load test with P99/RPS verdicts
npm run benchmark:router    # router micro-bench
```

State the before/after numbers in the pull request. Regressions on the hot path
are not accepted without a documented trade-off.

## Style and tooling

```bash
npm run lint          # eslint
npm run format        # prettier --write
npm run format:check  # verify formatting
```

Please run `npm run format:check` and `npm run lint` before opening a PR.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`,
  `fix:`, `docs:`, `perf:`, `refactor:`, `test:`, `chore:`.
- Keep commits focused; one logical change per commit.
- A pull request should explain **what** changed and **why**, and include the
  tests that prove it. Link any related issue.
- CI runs typecheck, tests, and build. A red pipeline is not ready for review.

## Documentation

Docs live in two places:

- `README.md` — the project front door.
- `site/` — the documentation site (Astro + Starlight). Source is under
  `site/src/content/docs/`. To preview locally: `npm run site:dev`.

If your change alters configuration or public API, update the relevant docs page
in the same pull request.

## Reporting bugs and requesting features

Open an issue at
<https://github.com/wicahma/typescript-gateway/issues>. For anything
security-related, do **not** open a public issue — see
[SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
