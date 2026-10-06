# Intent

## Purpose

Clef is a self-hosted personal AI agent.

Give people a capable personal agent on compute and storage they control. Personal agents handle deeply private information. Control of that information is the reason for this project, not an optional deployment feature.

User-controlled compute can be a personal machine or a server in the user's cloud account. It does not require local inference.

## Product experience

The primary interface is a clean, minimal terminal UI. Typing `clef` opens chat. Typing `/settings` opens server configuration. Keep the transcript, editor, status, and approvals clear. Use Pi-like terminal behavior rather than decorative screens or a web app.

The client and server are separate. Localhost is the default, but the same TUI can connect to a remote server through HTTPS or an SSH tunnel. Closing the client must not stop the server or its agent work. The client does not own the agent loop or persistent agent state.

Local access uses the OS user, without a Clef account. Remote access uses revocable client credentials. Keep setup short without removing authentication or secret protection.

David found OpenClaw and Hermes inadequate in both agent behavior and messaging-based interaction. Address capable behavior and direct interaction, not only installation friction. A messaging relay is not the primary experience. Dependable execution is a release requirement, not a competitive differentiator.

## Product invariants

1. **The user controls deployment and stored data.** Do not require a Clef-hosted service to hold personal state.
2. **The user chooses inference.** Support local and cloud models. Never silently replace a local model with a cloud model.
3. **Data flow is clear.** Explain which services receive personal data. Self-hosting does not hide context from the selected cloud model provider.
4. **Self-hosting must be usable.** Setup, updates, backups, and recovery are product responsibilities.
5. **The server is the core.** Keep it small and extensible through clear primitives. Clients use its public interface.
6. **Clef can change its own behavior.** Allow validated non-secret configuration changes and, when safely bounded, restricted extensions. Keep the server available during reloads.

## Engineering constraints

- Use TypeScript, Pi Durable for the agent harness, and Pi TUI for terminal controls. Keep server and client implementation separate behind the Clef API.
- Use Pi Codemode for model-written JavaScript. The first MVP does not include a host shell, Just Bash, or required VM workers.
- Use local SQLite for structured runtime state and a persistent folder or volume for skills, projects, notes, and workspace files.
- Use configuration files as the source of truth for non-secret settings, with references to one encrypted secret store. Validate complete replacements before activation. Failed reloads retain the last valid configuration.
- Keep encryption keys and provider credentials out of model context and untrusted code. Protect automatic-unlock keys outside SQLite and the workspace. Do not replace a lost established key.
- Authenticate every client operation. Deny external tool access by default. Offer Deny, This time, Always, and Never for exact scopes. Scripts cannot grant themselves access.
- Run trusted tools in-process when this is sufficient. Run untrusted code only in a restricted runtime with bounded resources and checked nested host calls.
- Add VM workers later for bounded delegated tasks that need browser use, computer control, or separate OS isolation. Do not pass server credentials or unrestricted host access to them.
- Support ChatGPT and OpenRouter sign-in, supported provider API keys, and local Ollama servers. Preserve explicit model choices. Provider connections never silently replace existing defaults.
- Keep the server on loopback by default. Support remote clients through HTTPS proxies, including Tailscale Serve, and loopback SSH tunnels. Do not accept ordinary remote HTTP or disable certificate checks.
- Support direct Linux and macOS installation. Linux container packaging remains planned. There is no direct Windows installation path. A container is not a VM and does not protect exposed mounts or credentials.
- Build through small tested steps. Follow the [module rules](ARCHITECTURE.md#server-modules) and [quality gates](CONTRIBUTING.md#check-a-change). Do not retain obsolete clients or weaken checks to finish a refactor.

## First implementation

The working slice includes local OS-user access, remote client tokens, encrypted provider credentials, key recovery, provider sign-in orchestration, model settings, a shared main conversation, searchable conversation history, concurrent replies, streaming updates, cancellation, and terminal chat. The TUI provides configuration and inline approvals through the same API. There is no web app or password-login compatibility path.

This is not the complete agent MVP. Keep these limits explicit:

- **Self-configuration is limited to model selection.** The agent can inspect non-secret configuration and request an exact default change, optionally switching its own conversation. Terminal chat provides approval. General file access, generic secret references, and extension configuration remain planned. See [configuration limits](ARCHITECTURE.md#configuration-files-and-live-activation).
- **Code execution is disabled.** Pi Codemode `1.0.1` exposes time and guest-memory limits but no host-output byte limit. Its host collector accumulates output before returning. Truncating the final result does not bound that memory use. Only the two bounded trusted configuration tools are enabled. A live Luna-to-Qwen/Ollama self-switch remains unverified.
- **Live provider evidence is limited.** David completed ChatGPT sign-in and an OpenAI response on 2026-10-03 with the previous client. This does not verify the new TUI flow, token refresh, expired provider credentials, or other accounts. Automated tests use controlled external providers with the real server, storage, harness, and terminal controls.
- **Model defaults need review.** The current rule prefers `gpt-6-luna` when available, otherwise the first model of the explicitly connected provider, with medium thinking when supported. These are provisional product defaults.
- **Ollama is an external service.** Discovery and inference are supported. Ollama installation, downloads, cloud aliases, and server authentication are outside this scope.
- **Remote transport is client-server, not hosting automation.** Users configure HTTPS, Tailscale, SSH, and network access themselves. Tests cover isolated HTTP and terminal behavior; live tailnet configuration is not verified. The server remains a native user-session service, not a privileged boot service.
- **Further capabilities remain planned.** Container packaging, MCP connections, restricted extensions, VM workers, and host computer use are unfinished. Provider prompt variants and live cancellation need further verification. This build is not a security audit.

## Decision status

The [architecture](ARCHITECTURE.md) defines the current design. The supported client is the TUI; earlier web and native-app plans are not implementation requirements for this version. Keep the API independent so a later client does not require a new agent loop.

Future worker deployment, extension loading, broader tool permissions, and host discovery remain open. Provisional provider defaults need product approval before release. Local research under gitignored `tmp/` informs decisions but does not settle them.
