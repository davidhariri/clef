# Contributing

Use Node 24 LTS, npm, and Python 3.11 or newer. The terminal E2E driver uses Python's standard pseudo-terminal library. Install dependencies and the test browser:

```sh
npm ci
npx playwright install chromium
```

On Linux, use `npx playwright install --with-deps chromium` to install browser system dependencies too. The checks do not require approval of the currently reported optional package install scripts.

Biome is the only formatter and linter. The VS Code settings enable format-on-save when the Biome extension is installed.

## Before changing code

1. Read [AGENTS.md](AGENTS.md) and the relevant [server](ARCHITECTURE.md#server-modules) or [web](ARCHITECTURE.md#web-modules) module rules.
2. Identify the feature that owns the behavior. Read its public entry point, any API contract, and existing tests.
3. Extend the existing operation. Do not add a parallel path or reach into another feature's private files.
4. Ask before changing ownership, public boundaries, or quality rules.

## Add behavior

Use a small red–green–refactor cycle:

1. Add one failing test through the feature's public interface. Confirm the intended failure.
2. Add the smallest complete behavior that passes.
3. Refactor while the tests pass.
4. Add or extend a colocated Playwright test for user-visible behavior.

Keep feature tests with their server or web feature. Unit and integration tests use `*.test.ts`. Browser E2E tests use `*.e2e.spec.ts`. The test runners discover these files automatically. Keep shared test infrastructure and architecture checks in root `tests/`.

Build with `npm run build` before a focused E2E run. Tests serve the compiled web app; they do not rebuild it themselves. Rebuild after a web change. The full check always builds before E2E tests.

E2E tests must run the real application and server. For repeatable model tests, control the external provider boundary. Do not replace the UI, message service, permission service, or harness with mocks. Each test gets a separate data directory and local server. Terminal E2E tests run the real CLI in a pseudo-terminal and verify that it shares state with the browser. Keep terminal-specific tests under `src/client/`. Test real provider sign-in and inference separately; report that evidence separately.

## Check a change

```sh
npm run format
npm run check
```

`format` applies Biome formatting and safe fixes. `check` runs formatting and lint checks, dependency boundaries, TypeScript, unit/integration tests, the production build, and Playwright E2E tests.

For a focused test run during development:

```sh
npm test -- src/server/permissions/permissions.test.ts
npm run test:e2e -- src/server/accounts/accounts.e2e.spec.ts
```

A focused run does not replace the full check before completion. Do not use `.only`, `.skip`, suppression comments, relaxed rules, or changed expectations to hide a failure. Fix the cause. If a dependency blocks verification, report the blocker and mark the work incomplete.

## Readable source and web styles

Biome expands JavaScript and TypeScript objects and arrays. It preserves intentional blank lines, but does not infer logical steps. Separate guards, preparation, work, and returned results where they form distinct groups. Leave a blank line between functions and methods. Do not separate every statement or compress unrelated work onto one line. `tests/formatting.test.ts` checks object expansion and blank-line preservation through the actual formatter.

Use AI Elements for messages, conversation scrolling, and the composer. Use shadcn/ui for ordinary controls and dialogs. Prefer their stock behavior. Keep copied code separate from Clef-owned adapters; see [upstream sources](src/web/components/upstream/UPSTREAM.md). The server protocol and harness do not change when a UI component changes.

Keep semantic colors in `src/web/theme.css`. Clef-owned components use utilities such as `bg-background`, `text-muted-foreground`, and `text-destructive`. Both palettes use the same tokens. Tailwind's dark variant and the palette follow the system preference. There is no theme switch or saved preference.

`globals.css` contains Tailwind imports, dependency scanning, and base resets only. Other CSS must be in a same-name `.module.css` file next to its `.tsx` component. Prefer existing component variants and utility classes before adding CSS. `tests/web-styles.test.ts` rejects unscoped stylesheets, feature selectors in global CSS, and `:global` escapes. There is no file-length limit.

Biome limits Clef-owned functions to cognitive complexity 15. Refactor distinct operations when the rule fails. Do not split code into forwarding wrappers just to reduce its score. Copied upstream UI may retain its comments and complexity; other lint, type, boundary, and runtime checks still apply. `tests/formatting.test.ts` exercises the real formatter and complexity policy.

Use functional copy. Remove decorative taglines, not useful security notices or instructions. Web-only appearance tests live in `src/web/appearance.e2e.spec.ts`; they check both palettes, system changes, shared color variables, and retained safety instructions.

## Review a change

- Does one feature own each operation and data set?
- Do imports use the public interface rather than private files?
- Are routes thin, contracts browser-safe, and database queries local to their owner?
- Does the file tree stay inside the feature unless a public contract or application wiring changed?
- Do tests cover successful work, denied access, cancellation, and relevant failure paths?

Do not add placeholder layers or split files only to meet a size limit. Prefer a few focused files behind a small interface. Do not add Clef-owned code comments; express behavior in names, types, and tests. Preserve comments and legal notices in copied upstream sources. Keep architectural explanations in documentation.

CI runs the same full check. A CI workflow does not itself prevent direct pushes or merges; repository protection must require its result. Changes to protection settings require David's approval.
