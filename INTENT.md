# Intent

## Purpose

Clef is a self-hosted personal AI agent harness.

Give people a capable personal agent, with an experience close to Muse or Grok Bot, running on compute and storage they control. Personal agents handle deeply private information. Control of that information is the reason for this project, not an optional deployment feature.

User-controlled compute can be a personal machine or a server in the user’s cloud account. It does not require local model inference.

## Product experience

Clef should earn adoption through capable agent behavior and purpose-built, open-source apps for desktop and mobile. A chat relay through Telegram or a similar service is not the primary experience.

David has used OpenClaw and Hermes and found both their agent behavior and messaging-based experience inadequate. This is the product problem to address, not merely installation friction. Translate concrete examples into behavior evaluations as we build.

Dependable execution is a release requirement, not a competitive differentiator.

## Product invariants

1. **The user controls the deployment and stored data.** Clef must run on user-controlled compute and storage, rather than require a Clef-hosted service to hold personal state.
2. **The user chooses inference.** Support local and cloud models. Do not silently replace a local model with a cloud model.
3. **Data flow is clear.** Explain which services receive personal data. Do not claim that self-hosting keeps data private from a cloud model provider when context is sent to that provider.
4. **Self-hosting must be usable.** Setup, updates, backups, and recovery are part of the product, not maintenance left unexplained to the user.
5. **The harness is the core.** Keep it small and extensible through a few clear primitives. Add capabilities without turning the core into a collection of app-specific workflows.

## Engineering constraints

- Use TypeScript for the server and agent core. Keep this repo focused on the service and its management web UI. First-party desktop and mobile apps are part of the product; their implementation and repo placement remain undecided.
- Provide an isolated VM work environment for agent tools. Main-loop placement remains undecided.
- Build through small, tested, working steps. Use TDD and automate repeatable checks in CI.
- Prefer simple code, clear names, deep modules, and one supported way to do each thing.
- Use `AGENTS.md` and focused skills for practices that need judgment. They do not replace tests or runtime enforcement.

## Decision status

The purpose, local-or-cloud model choice, and open-source first-party desktop and mobile apps were agreed on 2026-10-03.

VM technology, loop placement, storage engine, extension runtime, and initial deployment platform remain open. Local competitor research in `tmp/research/` informs those decisions; it does not settle them. Research files are not tracked in Git.
