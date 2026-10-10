# Contributing

Use Node 24 LTS and npm:

```sh
npm ci
npm run build
npm start
```

`npm start` and `npm run dev` use the canonical foreground `serve` entry. They do not register a native service. Use a temporary `CLEF_HOME` and a free `CLEF_PORT`; do not use a running user's data for development. `npm run chat` builds and runs `lib/main.js` with the same `CLEF_HOME` and `CLEF_PORT`. It attaches to an existing foreground or managed server. If neither is running, it starts a native service. Register only the built launcher: the service runs plain Node, not the development TypeScript loader.

Tests need no browser installation. Pi TUI renders into an isolated headless terminal for integration tests. Installed-client tests use a private pseudo-terminal. Neither takes over the active desktop.

Biome is the only formatter and linter. VS Code enables format-on-save when its Biome extension is installed.

## Before changing code

1. Read [AGENTS.md](AGENTS.md) and the relevant [server](ARCHITECTURE.md#server-modules) or [terminal](ARCHITECTURE.md#terminal-modules) rules.
2. Identify the owning feature. Read its public interface, contracts, and tests.
3. Extend its existing operation. Do not add a parallel path or import another feature's private files.
4. Ask before changing ownership, public interfaces, or quality rules.

## Add behavior

Use small red–green–refactor cycles:

1. Add one behavior test through the owning public interface. Confirm it fails for the intended reason.
2. Implement the smallest complete behavior that passes.
3. Refactor while tests pass. Remove obsolete code and tests when behavior is removed.

Choose coverage by risk, not by implementation layer:

- Use the lowest test level that reliably exposes the failure. Do not repeat cases without a distinct risk.
- Test server behavior through feature interfaces or authenticated HTTP. Test terminal behavior through real input and rendered output, not private UI methods.
- Keep strong coverage for authentication, token revocation, secret handling, permissions, persistence, reconnect, cancellation, and restart.
- Use the real server, storage, and Pi Durable for agent journeys. Control only the external model provider for repeatable tests. Verify live provider sign-in and inference separately.

Keep tests with their feature. Root `tests/` contains cross-cutting tests and shared infrastructure. Use `*.test.ts` for Vitest and `*.e2e.spec.ts` for Playwright's API and process test runner. Do not restore browser automation for terminal tests.

## Check a change

| When | Checks |
| --- | --- |
| During code changes | Focused tests, formatting, and type feedback |
| After a group of edits | `npm run check:fast` |
| Before completing code or tooling | `npm run check` after the final relevant edit |
| Prose-only changes | Diff, whitespace, links, and anchors |

For focused feedback:

```sh
npm test -- src/tui/tui.test.ts
npm run format
npm run typecheck
npm run check:fast
```

`check:fast` runs lint, formatting checks, dependency boundaries, TypeScript, and all unit/integration tests. It does not build or run process E2Es.

Build before E2Es that install the package:

```sh
npm run build
npm run test:e2e -- src/server/lifecycle/lifecycle.e2e.spec.ts
```

Before completing code, dependencies, tooling, configuration, or CI changes:

```sh
npm run format
npm run check
```

`check` runs `check:fast`, the production build, and all API/process E2Es. CI uses the same full check. Focused checks do not replace it. Do not repeat a successful run if only prose changes afterward.

For prose-only changes:

```sh
git status --short
git diff --check
git diff --cached --check
```

Review staged, unstaged, and untracked files before using this path. Check changed link targets and heading anchors. Runtime prompts and executable fixtures are not prose-only, even in Markdown.

Do not use focused or skipped tests, suppression comments, relaxed rules, or changed expectations to hide a failure. Fix the cause. A failing test is allowed during the red step, not at completion. Report dependency or environment blockers and mark verification incomplete.

## Package and release

The package is `@davidhariri/clef`. Its `clef` executable dispatches local chat, remote chat, and service controls. See [installation](INSTALLATION.md).

`npm run build` creates server, transport, launcher, and TUI JavaScript under `lib/`. The package includes those files, the installation guide, and npm's required metadata, README, and license. Test and build dependencies stay in `devDependencies`. Keep install lifecycle scripts absent; installation must work with `--ignore-scripts`. `prepack` builds before ordinary packaging.

The full E2E command includes the `app` and `package` projects. Package and lifecycle tests pack and install once per worker, with scripts disabled. They invoke the installed CLI outside the checkout. Every test has separate data, a free loopback port, and a native service identity. Services stop before package removal. The update test reinstalls the archive explicitly. Tests need registry access or a sufficient npm cache.

Package tests use real pseudo-terminals for local startup, settings, exit, remote-token entry, and saved reconnection. They check that secret input is not echoed. They verify continued service operation after client exit, native reload, token revocation, permissions on files, and credential preservation across reinstall. No live model call is made.

Lifecycle tests cover unavailable managers, conflicts, registration failure, application startup failure, duplicate ownership, native crash recovery, and incompatible readiness responses. A verified native service must remain stoppable when its application protocol is incompatible. The development chat command also has a real startup test. Controlled failures replace only native host commands, not application operations or storage.

Native tests require a macOS desktop launchd domain or a Linux systemd user manager. CI connects to the Ubuntu runner's user bus through `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS`. Its preflight fails if the manager is unavailable. Do not create a privileged service, enable lingering, change the developer's account, or substitute mocks for missing Linux evidence.

A supervisor reload is not an actual reboot. Report the tested OS. macOS results do not prove Linux runtime behavior. Live Tailscale, provider sign-in, and real reboot evidence are separate from deterministic tests.

Before release:

1. Choose an unpublished version and update the manifest and lockfile.
2. Run `npm run format` and `npm run check`. Do not publish with failures.
3. Find the verified archive with `find test-results -name 'davidhariri-clef-*.tgz'`.
4. Inspect its contents and obtain explicit publication approval. Publish that archive with `npm publish <archive-path> --access public --ignore-scripts`, not the checkout.
5. Confirm registry version and integrity. Inspect uncertain outcomes before retrying.

Do not change source between verification and release. Published version contents cannot be replaced. User data and credentials stay outside the package.

## Readable source and terminal styles

Biome expands objects and arrays. It preserves blank lines but does not infer logical steps. Separate guards, preparation, operations, and results where these are distinct. Put a blank line between methods and functions. Do not compress unrelated work onto one line.

Keep cognitive complexity at 15 or less. Split real responsibilities, not arbitrary forwarding wrappers. Clef-owned code has no comments or suppression directives. Architecture and formatter tests enforce these policies.

Use Pi TUI controls before custom rendering. Keep semantic styles in `src/tui/components/theme.ts`; use the terminal's own palette and background. Keep copy functional. Sanitize untrusted terminal content. Never put secret text into a generic visible input or transcript.

## Review a change

Keep each PR to one behavior change or focused maintenance task. Include necessary removal and cleanup; keep unrelated work separate.

- Does the change extend its owning feature through the public interface?
- Does each test protect a distinct risk through a real operation?
- Does each documentation edit correct a fact in its owning document?
- Can the reviewer follow the change without unrelated edits? Explain cross-feature changes when they are necessary.

Keep the PR summary to three points: change, main risk, and verification. Include failed or blocked checks. A short summary does not replace readable source and tests.

CI checks pull requests and pushes to `main`, not duplicate feature-branch pushes. Repository protection must require its result; a workflow alone does not prevent direct pushes. Changes to protection settings require David's approval.
