# Repository Guidelines

## Project Structure & Module Organization

SwarmAgent is a Tauri desktop application with a React and TypeScript frontend and a Rust backend. Frontend code lives in `src/`: UI components in `components/`, shared logic in `lib/`, Zustand stores in `store/`, Tauri integration in `tauri/`, and images in `assets/`. Static files live in `public/`. Rust commands, PTY handling, and agent integration live in `src-tauri/src/`; Tauri configuration and icons are under `src-tauri/`. See `docs/` for architecture and manual smoke tests, and `scripts/` for build and release utilities.

## Build, Test, and Development Commands

Install Node.js, Rust, and the Tauri platform prerequisites, then run `npm install`.

- `npm run tauri dev` starts the desktop app in development mode; `npm run dev` starts the Vite frontend alone.
- `npm run build` type-checks TypeScript and builds the frontend; `npm run tauri build` packages the desktop app.
- `npm test` runs Vitest once; `npm run test:watch` runs it interactively.
- `npx tsc --noEmit` checks frontend types without emitting files.
- From `src-tauri/`, run `cargo test`, `cargo fmt --check`, and `cargo clippy --all-targets -- -D warnings` for Rust changes.

## Coding Style & Naming Conventions

Follow surrounding code: TypeScript uses two-space indentation, single quotes, and generally omits semicolons. Use PascalCase for React components and types, camelCase for functions and variables, and descriptive kebab-case filenames such as `terminal-session.ts`. Follow Rust's standard formatting and snake_case naming; run `cargo fmt` before submitting Rust changes. Keep changes consistent with existing patterns.

## Testing Guidelines

Place Vitest tests beside the code they cover using `*.test.ts` names. Add tests for new `src/lib/` logic and meaningful behavioral changes. Rust tests run through Cargo. For terminal, workspace, or Agent Team changes, follow the relevant cases in `docs/manual-smoke-tests.md`. No numerical coverage threshold is specified.

## Commit & Pull Request Guidelines

Recent commits commonly use concise, imperative prefixes such as `fix(token-usage):`, `feat(token-usage):`, and `perf(terminal):`. Describe the change and its motivation in the pull request, link an issue when available, and complete `.github/PULL_REQUEST_TEMPLATE.md` checks. Include screenshots or recordings when they help reviewers assess UI changes.
