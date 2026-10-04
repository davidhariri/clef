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

`npm start` and `npm run dev` use the canonical foreground `serve` entry. They do not register a native service. `npm run dev` runs the TypeScript server directly and still needs a built web app in `dist/`. Use a temporary `CLEF_HOME` and a free `CLEF_PORT` for development; do not point development at a running user's data.

Biome is the only formatter and linter. The VS Code settings enable format-on-save when the Biome extension is installed.

## Before changing code

1. Read [AGENTS.md](AGENTS.md) and the relevant [server](ARCHITECTURE.md#server-modules) or [web](ARCHITECTURE.md#web-modules) module rules.
2. Identify the feature that owns the behavior. Read its public entry point, any API contract, and existing tests.
3. Extend the existing operation. Do not add a parallel path or reach into another feature's private files.
4. Ask before changing ownership, public boundaries, or quality rules.

## Add behavior

Use a small red–green–refactor cycle:

1. Add or extend one test through the feature's public interface. Confirm that it fails for the intended reason before changing production code.
2. Add the smallest complete behavior that passes.
3. Refactor while the tests pass. Remove obsolete code and tests for behavior that was replaced.

Select coverage by risk, not by file or layer:

- Use the lowest test level that can expose the failure reliably. Do not repeat the same cases at each layer unless they cover distinct risks.
- Use Playwright for critical user journeys and browser-specific failures. A user-visible change does not automatically need a new E2E test.
- Keep regression coverage for defects and strong coverage for authentication, permission denial, secret handling, persistence, reconnect, cancellation, and restart as those paths are built.
- Extend existing coverage before adding a suite. Remove redundant tests only when retained coverage protects the same behavior. Do not retest library internals or standard formatter and type-checker behavior; test Clef-specific policy where it adds protection.

Keep tests with the owning feature; see [test placement](AGENTS.md#one-server-structure). Keep cross-cutting package tests in root `tests/`. E2E tests must run the real application and server, with separate data directories and local servers. For repeatable model tests, control the external provider boundary; do not mock the UI, feature operations, or harness. Use the web app for agent behavior tests. Verify real provider sign-in and inference separately, and report only what was verified.

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

For a focused E2E run, build first. Tests serve the compiled web app and do not rebuild it. Rebuild after web changes:

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

Do not use `.only`, `.skip`, suppression comments, relaxed rules, or changed expectations to hide a failure. Fix the cause. A failing test is allowed during TDD's red step, not at completion. If a dependency blocks verification, report the exact blocker and mark the work incomplete.

## Package and release

The npm package is `@davidhariri/clef`. Its `clef` executable manages the native user-session server. It does not provide a separate chat client. See [service controls and updates](INSTALLATION.md).

`npm run build` creates server JavaScript in `lib/` and the web app in `dist/`. Only those outputs, the installation guide, and license notices are included with npm's required package metadata and README. Web and build dependencies stay in `devDependencies`. Keep install lifecycle scripts absent; users must be able to install with `--ignore-scripts`. `prepack` builds local source before ordinary packaging.

The full E2E command includes the `app` and `package` projects. Package and lifecycle tests pack and install Clef once per worker, with scripts disabled, then invoke the installed CLI outside the source checkout. Each test has its own temporary prefix link to that installed package, unique data, a free loopback port, a native service identity, and a service configuration path. Test services stop before the shared package is removed. The update test still reinstalls the archive explicitly. These tests need npm registry access or a sufficient npm cache.

The package test uses the real web setup and sign-in pages. It checks CLI exit, repeated start, status, stop, native configuration reload, and account preservation across an archive reinstall. Lifecycle tests cover unavailable managers, conflicts, failed registration, failed application startup, duplicate ownership, and native crash recovery. Controlled failures replace only native host commands, not the app or storage. No live model call is made.

Native tests require a macOS desktop launchd domain or a Linux systemd user manager. The check workflow connects to the ephemeral Ubuntu runner's user bus through `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS`. Its preflight fails if that manager is unavailable; it does not create a privileged service, enable lingering, or change account settings. A runner without a user manager needs an explicitly provisioned user-session test environment before these tests can run. Do not substitute mocks for Linux native evidence or change a developer's real account to make CI tests pass.

A supervisor reload tests the saved runtime configuration, not an actual reboot. Report which OS ran the native tests. macOS results do not prove Linux runtime behavior. Real reboot and provider sign-in evidence are separate from the deterministic suite.

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

Keep each PR to one behavior change or one focused maintenance task. Include cleanup needed for that change; keep unrelated cleanup separate. Do not use line-count quotas or compressed code to make a diff look smaller.

- Does the change extend the owning feature through its public interface, without duplicate operations or unnecessary layers?
- Does each added test protect a distinct behavior or risk? Can existing setup or coverage be reused without hiding the test's purpose?
- Does each documentation edit correct or add a necessary fact in its owning document? Omit routine implementation summaries.
- Can the reviewer understand the change without following unrelated edits? Explain necessary cross-feature changes.

Keep the PR summary to three points: what changed, the main risk, and how it was verified. Include failed or blocked checks. A short summary does not replace readable code and tests.

CI runs the same full check on pull requests and pushes to `main`. Feature-branch pushes do not duplicate the PR check. A CI workflow does not itself prevent direct pushes or merges; repository protection must require its result. Changes to protection settings require David's approval.
