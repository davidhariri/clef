# Project rules

## Implementation

- Use TypeScript for the server and agent core.
- When removing a feature, also remove its tests, unused code, dependencies, and obsolete documentation. Keep coverage for behavior that remains.
- Use Pi Durable as the agent harness and Pi Codemode for restricted JavaScript execution.
- Prefer secure-by-default in-process execution. Future VMs are optional workers for delegated subagent tasks, not the main agent's required home.
- Use local SQLite for structured server state and a persistent folder or volume for workspace files.
- Route client-agent interaction through the Clef API. Do not add a separate agent loop to the web or native apps. Use the web app as the minimum interface for testing agent behavior; do not maintain a separate CLI chat client.

## One server structure

Read [ARCHITECTURE.md](ARCHITECTURE.md#server-modules) before changing module boundaries. Follow [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.

- Build a feature-based modular monolith. Put each domain under `src/server/<feature>/`. Keep its routes, contracts, domain rules, persistence, and tests together.
- Select the owning feature before writing a test or implementation. Extend that feature. Do not add a second path for the same operation.
- `index.ts` is the small public server interface. `contract.ts` contains browser-safe API schemas and types. All other feature files are private to that feature. This rule also applies to type-only imports and tests in other features.
- Clients may import feature `contract.ts` files only. They may not import a server `index.ts`, implementation, or Pi harness types. Contracts may depend only on Zod and other public contracts.
- Keep `app.ts` as the composition root and `main.ts` as the process entry. Connect dependencies explicitly. Do not put business rules, SQL, or feature routes in these files. Do not add a service locator, global container, or automatic feature loader.
- `platform/` contains shared technical mechanisms only. It must not know features or contain their SQL, rules, schemas, or credentials. Database connection ownership is not ownership of all persisted data.
- Each feature owns its tables and schema changes in `repository.ts`. Only its repository uses those tables. Pass the shared database handle at module construction; do not expose it from a feature interface. Pi Durable remains the only owner of harness messages and task state.
- Use `routes.ts` for HTTP translation, `service.ts` for operations, and `model.ts` for domain types and rules when these roles need separate files. Do not create empty layers or one-line wrappers to satisfy a template. Split by responsibility, not a line-count target.
- Do not create global business-layer folders such as `routes/`, `services/`, `repositories/`, `controllers/`, `utils/`, or `shared/`. Do not recreate a central `Store` or contracts dump.
- Keep feature tests in their feature. Root `tests/` is for shared test infrastructure and cross-cutting architecture checks, not a second feature tree. Unit tests use `*.test.ts`; Playwright tests use `*.e2e.spec.ts`.
- Internal feature changes should normally touch one feature directory. Public contract changes can require client changes. New features can require composition changes. Inspect the PR file tree; explain other cross-feature edits rather than hiding dependencies.
- Boundary rules discover feature folders automatically. Do not add exceptions or bypass them through re-exports, dynamic imports, casts, or test-only access. Ask David before changing this architecture or its enforcement.

## Web modules

- Organize `src/web/` by feature. Import another feature only through `index.ts` or `index.tsx`. Keep hooks and state with the behavior they serve.
- Use AI Elements for chat primitives and shadcn/ui for controls and dialogs. Prefer working stock behavior over custom styling. Keep the Clef API and server-side agent loop; these components do not replace either.
- `components/` contains application-independent UI. It cannot import Clef contracts, API clients, platform code, or features. `platform/` contains shared mechanisms and cannot import web features.
- Keep copied sources in `src/web/components/upstream/`. Follow its `UPSTREAM.md` for source versions, notices, local changes, and updates. Do not put Clef business logic there.
- Limit global CSS to `globals.css` for Tailwind setup and base resets, and `theme.css` for semantic palettes. Put any necessary component CSS in a same-name `.module.css` file next to its `.tsx` owner. Do not use `:global` to escape component scope.

## Secrets

- Keep account passwords and the installation encryption key separate. Hash passwords; encrypt stored secrets.
- Keep the server's key copy outside SQLite and the workspace. Support automatic unlock without exposing the key to the model or untrusted code.
- Never record encryption keys or provider credentials in traces, analytics events, application logs, or model context.
- Do not use plaintext Pi credential storage. Use Clef's encrypted secret store.
- Treat in-process tool implementations as trusted server code. They can perform work directly, including web requests.
- Run model-written JavaScript only in Pi Codemode's restricted runtime. Never evaluate it or load untrusted extensions in the host JavaScript environment. A worker thread alone is not a sandbox.
- Validate and authorize every direct or nested tool action. Deny external access by default. Offer Deny, This time, Always, and Never for the scope shown; scripts cannot grant permissions.
- Bound script and host-call resources. Do not blindly replay interrupted scripts with possible side effects.
- Enforce output limits before accumulating output in host memory. Truncating a completed result is not a resource limit. Do not enable Codemode until its host collector, return values, and host-call work have tested bounds. See the implementation limits in `INTENT.md`.
- Do not expose a host shell or add Just Bash to the first MVP. Do not pass server secrets or unrestricted host access to future VM workers.

## Tests and quality gates

- Follow [Add behavior](CONTRIBUTING.md#add-behavior) for TDD and risk-based coverage. Test behavior through public interfaces, not every implementation layer.
- Follow [Check a change](CONTRIBUTING.md#check-a-change) for required checks. Keep the full completion check for code and tooling; use diff and link checks for prose-only changes.
- Use Biome as the only formatter and linter, strict TypeScript for types, and Dependency Cruiser for module boundaries. Do not add competing tools or tests that duplicate their standard checks.
- Fix failing checks before completion, including failures exposed by the current work. Ask David before changing the quality policy; never weaken checks merely to get a pass.
- Treat review effort as a quality constraint. Follow [Review a change](CONTRIBUTING.md#review-a-change); keep unrelated cleanup separate.

## Code clarity

- Do not add comments to Clef-owned code, including inline, block, or documentation comments. Copied UI sources in `src/web/components/upstream/` may retain upstream comments and required modification notices.
- Express meaning through strong types, precise names, simple control flow, and focused tests. Simplify confusing code instead of explaining it with comments.
- Keep Clef-owned functions at cognitive complexity 15 or less. Split real responsibilities rather than hide complexity behind arbitrary wrappers. Copied upstream UI has a scoped complexity exception, not an exemption from other checks.
- Write for human readers, not minimum line count. Use expanded object and array literals. Biome enforces this layout; do not override it to compress code.
- Use one blank line between distinct logical steps, before a result returned after preparation, and between functions or methods. Keep closely related statements together. Biome preserves these blank lines but does not invent them; review spacing as part of code quality.
- Prefer small public interfaces over forwarding layers. Add test helpers only when they remove repeated setup without hiding the behavior under test.
- If a tool or dependency requires a code comment, ask before making an exception.

## Web appearance and copy

- Do not add decorative taglines or filler text. Keep labels, instructions, status, errors, and security or data-flow explanations.
- Define both palettes in `src/web/theme.css`. Use semantic Tailwind utilities such as `bg-background` and `text-muted-foreground` in Clef-owned components. Do not add custom literal colors outside the palette. Keep stock upstream component styles in their copied sources.
- Follow the system appearance with `prefers-color-scheme`. Do not add a theme toggle or store an appearance preference.
- Test light and dark rendering in Playwright, including native controls and live system changes. Keep web-only appearance tests in `src/web/`.

## Documentation

- Write all documentation in ASD-STE100 Simplified Technical English. Use short sentences, clear instructions, and consistent technical terms.
- Use Mermaid diagrams when a diagram explains the system or a process more clearly than text.
- Document each fact once; link to its owner instead of repeating it. Keep usage in `README.md`, workflow in `CONTRIBUTING.md`, architecture in `ARCHITECTURE.md`, and goals and constraints in `INTENT.md`.
- Change docs only when usage, workflow, constraints, architecture, or necessary rationale changes. Prefer an edit to the owning document over a new file.
- Do not add routine implementation summaries, progress reports, decision histories, or a document per feature. Keep temporary research and decision notes in gitignored `tmp/`.
- Describe settled decisions as the current design and planned capabilities as plans. Do not imply they already work.
