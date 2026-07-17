# Repository Guidelines

## Project Structure & Module Organization

This pnpm/Turborepo monorepo keeps the CLI in `apps/pushc`, runtime-neutral orchestration in `packages/core`, and integrations in `packages/adapter-*`. Workspaces use `src/` and `test/`; never edit `dist/`.

Keep dependencies flowing from the CLI to adapters to core. Core must not import adapters, Node APIs, TOML parsers, or platform SDKs.

## Documentation-First Workflow

`docs/architecture/` is the ground-truth. Before code changes, read relevant architecture, implementation, and tests; resolve mismatches first.

At implementation start, create `docs/plan/<YYMMDD>-<requirement-name>.md`, for example `docs/plan/260718-target-aliases.md`. Capture background and goals, key decisions, and the technical approach.

Update affected architecture documents with code changes. A task is incomplete while code, tests, and architecture disagree.

## Change Compatibility & Implementation

The project is in a high-frequency development phase; breaking changes are acceptable. When changes affect historical data or behavior, ask the user whether backward compatibility is required. If it is not required, remove old logic and documentation completely, including compatibility branches and stale abstractions; refactor as needed to keep one simple, direct path.

Work from first principles: clarify the real problem, identify the smallest behavior change that solves it, and prefer direct implementation. Avoid speculative extensibility, generic frameworks for one use case, and over-encapsulation that obscures execution flow.

## Build, Test, and Development Commands

Use Node.js 24+ and the pinned pnpm version.

- `pnpm install`: install dependencies.
- `pnpm build`: build all workspaces.
- `pnpm typecheck`: check TypeScript.
- `pnpm test:ci`: run Vitest once, as CI does.
- `pnpm dev`: start watch builds.
- `pnpm --filter pushc test`: watch CLI tests.
- `pnpm format`: run Prettier.

## Coding Style & Naming Conventions

Write ESM TypeScript with explicit public types. Prettier uses two spaces, semicolons, single quotes, 100-column lines, and no trailing commas. Use `camelCase` values, `PascalCase` types, kebab-case directories, and `.js` for ESM imports. Keep platform behavior in adapters.

## Testing Guidelines

Vitest files follow `test/*.test.ts`. Add focused behavior and regression tests. Mock network/platform boundaries; never require live services. Before a pull request, run typecheck, tests, and build. Cover success, validation, and errors.

## Commit & Pull Request Guidelines

Use focused, imperative Conventional Commits, such as `feat: add target aliases`. Pull requests explain behavior, affected workspaces, linked issues, and configuration impact; include CLI output or screenshots for visible changes and ensure CI passes.

## Security & Configuration

Never commit URLs, tokens, `.env`, or real configuration credentials. Use placeholders and keep logs from exposing adapter options.
