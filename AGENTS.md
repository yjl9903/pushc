# Repository Guidelines

## Project Structure & Module Organization

This pnpm/Turborepo monorepo keeps the CLI in `apps/pushc`, runtime-neutral orchestration in `packages/core`, and integrations in `packages/adapter-*`. Workspaces use `src/` and `test/`; never edit `dist/`.

Keep dependencies flowing from the CLI to adapters to core. Core must not import adapters, Node APIs, TOML parsers, or platform SDKs.

## Documentation-First Workflow

`docs/architecture/` is the ground-truth. Before code changes, read relevant architecture, implementation, and tests; resolve mismatches first.

Use a plan only when combined implementation size and impact are substantial; small localized changes need none. Reuse and update an existing same-context plan. Create `docs/plan/<YYMMDD>-<requirement-name>.md` only when the topic genuinely changes. Capture background and goals, key decisions, and the technical approach.

Update affected architecture documents with code changes. A task is incomplete while code, tests, and architecture disagree.

## Change Compatibility & Implementation

The project is in high-frequency development; breaking changes are acceptable. When changes affect historical data or behavior, ask the user whether backward compatibility is required. If not, delete old code, documentation, compatibility branches, and stale abstractions; refactor toward one simple, direct path.

Use first principles: clarify the real problem, make the smallest sufficient behavior change, and prefer direct implementation. Avoid speculative extensibility, single-use generic frameworks, or over-encapsulation that obscures execution.

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

Vitest files follow `test/*.test.ts`. Add focused behavior and regression tests. Mock network/platform boundaries; never require live services. Run typecheck, tests, and build before a pull request; cover success, validation, and errors.

## Commit & Pull Request Guidelines

Use focused, imperative Conventional Commits, such as `feat: add target aliases`. Pull requests explain behavior, affected workspaces, issues, and configuration impact; show visible changes and ensure CI passes.

## Security & Configuration

Never commit URLs, tokens, `.env`, or real configuration credentials. Use placeholders and keep logs from exposing adapter options.
