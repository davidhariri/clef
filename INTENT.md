# Intent

## Purpose

Clef is a self-hosted personal AI agent harness.

Give people a capable personal agent, with an experience close to Muse or Grok Bot, running on compute and storage they control. Personal agents handle deeply private information. Control of that information is the reason for this project, not an optional deployment feature.

User-controlled compute can be a personal machine or a server in the user’s cloud account. It does not require local model inference.

## Product experience

Clef should earn adoption through capable agent behavior and purpose-built, open-source web, desktop, and mobile apps. The web app is a first-class way to talk to the agent from a desktop browser. It also provides setup and management. A chat relay through Telegram or a similar service is not the primary experience.

David has used OpenClaw and Hermes and found both their agent behavior and messaging-based experience inadequate. This is the product problem to address, not merely installation friction. Translate concrete examples into behavior evaluations as we build.

Dependable execution is a release requirement, not a competitive differentiator.

## Product invariants

1. **The user controls the deployment and stored data.** Clef must run on user-controlled compute and storage, rather than require a Clef-hosted service to hold personal state.
2. **The user chooses inference.** Support local and cloud models. Do not silently replace a local model with a cloud model.
3. **Data flow is clear.** Explain which services receive personal data. Do not claim that self-hosting keeps data private from a cloud model provider when context is sent to that provider.
4. **Self-hosting must be usable.** Setup, updates, backups, and recovery are part of the product, not maintenance left unexplained to the user.
5. **The harness is the core.** Keep it small and extensible through a few clear primitives. Add capabilities without turning the core into a collection of app-specific workflows.
6. **Clef can change its own behaviour.** Let the agent edit non-secret configuration files and build restricted extensions. Validate changes before activation. Keep the server available during configuration reloads.

## Engineering constraints

- Use TypeScript for the server and agent core. Keep this repo focused on the service, web app, and CLI chat TUI. First-party desktop and mobile apps are part of the product; their implementation and repo placement remain undecided.
- Use Pi Durable as the agent harness and Pi Codemode for restricted JavaScript execution. The first MVP does not include a host shell, Just Bash, or VM workers.
- Use local SQLite for structured runtime state, including accounts, sessions, traces, analytics events, messages, encrypted secrets, and Pi Durable task state. Keep skills, projects, notes, and other files in a persistent folder or volume.
- Store non-secret configuration in files as the source of truth, not in a second settings store in SQLite. Configurations contain references to one shared encrypted secret store, never secret values. Trusted server code resolves these references only for authorized operations.
- Load and reload configuration lazily without restarting the server or breaking client connections. Prepare and validate a replacement before activation. Keep the current valid version if preparation fails.
- Keep the installation encryption key separate from the user account. Show it for copying during setup only. Keep a protected server copy outside SQLite and the workspace for automatic unlock after restarts.
- Hash account passwords. Encrypt stored secrets. Keep the encryption key and server credentials out of model context and untrusted code.
- Do as much work as possible in-process through secure-by-default libraries. Keep model-written JavaScript in the restricted runtime and expose only permission-checked native and MCP tools. Do not load untrusted code into the host JavaScript environment.
- Deny external access by default. Offer Deny, This time, Always, and Never for clearly shown permission scopes. Apply checks to each nested action, not just its script.
- Add VM workers later for bounded subagent tasks that need browser use, computer control, or a separate OS isolation boundary. Grant only the data and capabilities needed for the task.
- On first startup, print a protected web setup link. Use two onboarding steps: account and encryption, then model provider.
- Support ChatGPT and OpenRouter sign-in, plus API keys for Anthropic, OpenAI, OpenRouter, and other supported Pi providers. Supply provider-specific model and thinking defaults, editable at Settings > Models > Default.
- Define a Clef API shared by the web app, chat TUI, and desktop and mobile apps. Local clients connect to the server without a gateway.
- Maintain a CLI chat TUI as the minimum interface for testing agent behavior. Keep the agent loop and stored state in the server.
- Support a Linux container installation through Docker, including OrbStack on macOS and Linux cloud VMs such as DigitalOcean Droplets.
- Support direct installation on Linux and macOS without a container. Do not provide direct Windows support.
- Make the greater host-access risk of direct installation clear. A container is not a VM and does not protect resources explicitly exposed to it.
- Build through small, tested, working steps. Use TDD and automate repeatable checks in CI.
- Prefer simple code, clear names, deep modules, and one supported way to do each thing.
- Structure the server by domain feature. Keep routes, contracts, behavior, storage, and tests local to their owner. Enforce public interfaces and acyclic dependencies; do not add global business-layer folders or a central storage module.
- Use Biome as the sole formatter and linter. Use strict TypeScript, Dependency Cruiser, Vitest, and Playwright. Extend E2E coverage as behavior changes; do not complete work with failing or skipped checks.
- Use `AGENTS.md` and focused skills for practices that need judgment. They do not replace tests or runtime enforcement.

## First implementation

The working chat slice includes account setup, encrypted provider credentials, key recovery, provider sign-in orchestration, model settings, persisted conversations, streaming updates, Stop, web chat, and terminal chat. Each server feature owns its behavior and tests. Import and layout checks enforce the module structure.

The web UI uses AI Elements for messages, scrolling, and prompt input, with shadcn/ui controls and dialogs. It keeps the Clef API and server-side agent loop. Web feature boundaries, global CSS placement, and a cognitive-complexity limit of 15 are enforced. Copied UI source versions and exceptions are recorded in `src/web/components/upstream/UPSTREAM.md`.

The stock Markdown and code renderer increases the web bundle. Vite reports generated chunks over 500 kB. This warning remains; the warning threshold was not raised.

This is not the complete agent MVP. Keep these limits explicit:

- **Self-configuration is planned.** Model defaults and saved permission rules are currently in SQLite. File-backed configuration, generic secret references, and validated live activation are not implemented yet.
- **Code execution is disabled.** Pi Codemode `1.0.1` exposes time and guest-memory limits, but no host-output byte limit. Its `dist/runtime/host.js` appends each output item to a host array. Cutting the returned result cannot prevent this accumulation. Obtain a bounded runtime before exposing scripts. The permission service is tested, but is not connected to executable tools or an approval UI yet.
- **One live ChatGPT connection is verified.** On 2026-10-03, David completed sign-in. Read-only inspection confirmed an encrypted OpenAI OAuth credential and a successful `openai-responses` reply from `gpt-6-luna`, with no recorded authentication error. No token values were printed. Token refresh, expired or revoked credentials, and other accounts remain unverified. Automated tests still use controlled external provider behavior with the real server, storage, harness, browser, and terminal.
- **Model defaults need review.** The current rule prefers `gpt-6-luna` when available, otherwise the first available model of the explicitly connected provider. It uses medium thinking when supported. These are provisional choices, not agreed product defaults. Existing defaults never switch when another provider connects.
- **Deployment is local only.** Container packaging, remote access, local-model setup, MCP, desktop and mobile apps, and host computer use remain unfinished. Single-process database ownership is an operating requirement, not yet an enforced process lock.
- **Release work remains.** Provider connection cancellation and all provider prompt variants need coverage. The public repository still needs a license decision. This build is not a security audit.

## Decision status

The purpose, local-or-cloud model choice, and open-source first-party desktop and mobile apps were agreed on 2026-10-03.

The [architecture](ARCHITECTURE.md) defines the system and installation paths. The first implementation uses Node 24 LTS, Fastify, React/Vite, HTTP/JSON commands, and SSE updates. The first server listens on localhost. Its automatic-unlock key is an owner-only file outside SQLite and the workspace. The server structure is a feature-based modular monolith. The local chat slice uses seven-day login sessions and request IDs for duplicate-send prevention. Production session policy and native app implementation remain open. Pi Codemode is selected for in-process script isolation. Saved web permissions use website origin plus HTTP method. The first web tool is a public HTTPS GET. Rule precedence, MCP connections, and resource limits still need definition. Future VM worker deployment and extension loading remain open. The provisional provider model and thinking defaults need product approval before release. Host discovery is outside the current scope. Future direct installations should support host computer use to operate local software that has no tool API, such as an MCP server.

Local competitor research in `tmp/research/` informs design decisions; it does not settle them. Research files are not tracked in Git.
