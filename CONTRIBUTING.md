# Contributing

Use Node 24 LTS and npm. Install dependencies and the test browser:

```sh
npm ci
npx playwright install chromium
```

On Linux, use `npx playwright install --with-deps chromium` to install browser system dependencies too. The checks do not require approval of the currently reported optional package install scripts.

Build both the server and web app before starting from a checkout:

```sh
npm run build
npm start
```

`npm run dev` runs the TypeScript server directly. It still needs a built web app in `dist/`.

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

Keep feature tests with their server or web feature. Unit and integration tests use `*.test.ts`. Browser E2E tests use `*.e2e.spec.ts`. The test runners discover these files automatically. Keep shared test infrastructure, architecture checks, and cross-cutting package tests in root `tests/`.

Build with `npm run build` before a focused E2E run. Tests serve the compiled web app; they do not rebuild it themselves. Rebuild after a web change. The full check always builds before E2E tests.

E2E tests must run the real application and server. For repeatable model tests, control the external provider boundary. Do not replace the UI, message service, permission service, or harness with mocks. Each test gets a separate data directory and local server. The web app is the working client and the interface for agent behavior tests. Test real provider sign-in and inference separately; report that evidence separately.

## Check a change

Use the smallest useful check during development. Keep the full check as the completion gate for code and tooling.

| When | Checks |
| --- | --- |
| During code changes | Focused tests for TDD, formatting, and type feedback |
| After a group of code edits | `npm run check:fast` |
| Before completing code or tooling changes | `npm run check` after the final relevant edit |
| Documentation-only changes | Diff review, whitespace checks, and changed links and anchors |

For focused feedback:

```sh
npm test -- src/server/permissions/permissions.test.ts
npm run format
npm run typecheck
npm run check:fast
```

`format` applies Biome formatting and safe fixes. `check:fast` runs lint, formatting checks, dependency boundaries, TypeScript, and all unit/integration tests. It does not build the app or run E2Es.

For a focused E2E run, build first:

```sh
npm run build
npm run test:e2e -- src/server/accounts/accounts.e2e.spec.ts
```

Before completing code, dependency, tooling, configuration, or CI changes:

```sh
npm run format
npm run check
```

`check` runs `check:fast`, the production build, and Playwright E2E tests. Focused and fast checks do not replace it. Run it after the final relevant edit; do not repeat a successful run when only documentation changes afterward. CI always runs the full check.

For documentation-only changes:

```sh
git status --short
git diff --check
git diff --cached --check
```

Review staged, unstaged, and untracked files before choosing this path. Review the documentation diff and verify changed link targets and heading anchors. Prose-only edits do not need application checks. Runtime prompts, test fixtures, and other executable inputs are not documentation-only, even when stored in Markdown files.

Do not use `.only`, `.skip`, suppression comments, relaxed rules, or changed expectations to hide a failure. Fix the cause. If a dependency blocks verification, report the blocker and mark the work incomplete.

## Package and release

The npm package is `@davidhariri/clef`. Its `clef` executable starts the server. It does not provide a separate chat client.

`npm run build` creates server JavaScript in `lib/` and the web app in `dist/`. Only those outputs and license notices are included with npm's required package metadata and README. Web and build dependencies stay in `devDependencies`. Keep install lifecycle scripts absent; users must be able to install with `--ignore-scripts`. `prepack` builds local source before ordinary packaging.

The full E2E command includes the `app` and `package` projects. The package test creates a tarball, checks its contents, installs it into an isolated global prefix with scripts disabled, and starts `clef` outside the source checkout. It checks the real setup page and API without making a live model call. This test needs npm registry access or a sufficient npm cache.

Before a release:

1. Choose an unpublished version and update `package.json` and the lockfile.
2. Run `npm run format` and `npm run check`. Do not publish if any check fails.
3. Find the verified archive with `find test-results -name 'davidhariri-clef-*.tgz'`. The successful package test keeps that exact archive for publication.
4. Inspect its contents and get explicit approval to publish. Publish that archive with `npm publish <archive-path> --access public --ignore-scripts`, not the working directory.
5. Confirm the published version and archive integrity in the npm registry. Do not repeat an uncertain publish without inspecting registry state first.

Do not change the source between verification and release. Existing version contents cannot be replaced. Keep user data and credentials outside the package.

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
