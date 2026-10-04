# Architecture

This document defines the target structure and its rules. See [First implementation](INTENT.md#first-implementation) for the executable scope and known limits.

```mermaid
flowchart TB
    apps["Desktop and mobile apps"] <--> api
    web["Web app · Chat and management"] <--> api

    subgraph host["Host environment"]
        subgraph server["Clef server · TypeScript"]
            api["Clef API"]
            agent["Pi Durable"]
            subgraph sandbox["Restricted runtime · Worker thread"]
                code["Pi Codemode · QuickJS / WebAssembly"]
            end
            permissions["Permission checks"]
            tools["Trusted tool implementations"]
            api <--> agent
            api <--> permissions
            agent --> code
            code --> permissions
            permissions --> tools
        end
        database[("Local SQLite")]
        files["File workspace · Folder or volume"]
        server --> database
        tools <--> files
    end

    agent --> models["Local or cloud model"]
    tools --> services["Web and MCP services"]
    tools -. "Delegate approved task" .-> vm["Future VM worker · Subagent with browser / computer"]
```

The server is the core of Clef. API handlers, Pi Durable, and trusted tool implementations run in the same server process. Pi Durable is an imported library, not a separate service. The server owns conversations and stored state. It also serves the web app for chat, setup, and management.

Do as much work as possible in-process through restricted runtimes and permission-checked tools. A tool can make a web request without a separate service. A local model can run on the same computer as the server.

Pi Codemode runs model-written JavaScript in a restricted runtime within the server process. The first MVP does not expose a host shell or include Just Bash. A VM is a future optional worker for delegated tasks, not the default home of the main agent.

## Server modules

Clef is a feature-based modular monolith: one server process with separate domain modules. Put code that changes together in the same feature. Keep implementation details behind a small public interface.

```text
src/server/
  main.ts                    Process entry and shutdown
  app.ts                     Explicit module construction and route registration
  lifecycle/                 Native user service, process ownership, and private readiness
  platform/database.ts       Database connections, process locks, and installation paths
  accounts/                  Account setup, passwords, and login sessions
  credentials/               Encryption key, encrypted credentials, and recovery
  permissions/               Pending approvals and saved access rules
  models/                    Provider connections and model selection
  agent/                     Pi Durable and Codemode integration
  messages/                  Conversation and message API
```

The tree defines ownership as the modules are built. It is not a requirement to create empty modules in advance.

### Inside a feature

| File | Responsibility |
| --- | --- |
| `index.ts` | Small public server interface and feature construction |
| `contract.ts` | Browser-safe request/response schemas and types |
| `routes.ts` | Validate and translate HTTP requests; call feature operations |
| `service.ts` | Implement operations and their ordering |
| `model.ts` | Domain types, rules, and calculations |
| `repository.ts` | Owned tables, SQL, and schema changes, when needed |
| `*.test.ts` | Unit and integration tests through useful public interfaces |
| `*.e2e.spec.ts` | Feature E2E tests against the real app |

Use only files that have a distinct responsibility. Do not require every operation to pass through every file. Do not add a generic repository framework, duplicated DTOs, or forwarding layers without a real need.

```mermaid
flowchart LR
    app["app.ts · Connect dependencies"] --> entry["Feature index.ts"]
    client["Web app"] --> contract["Feature contract.ts"]
    client -->|HTTP| routes["Feature routes.ts"]
    routes --> service["Feature service.ts"]
    service --> model["Feature model.ts"]
    service --> repository["Feature repository.ts"]
    other["Other server feature"] --> entry
```

### Import rules

A server feature can use another feature only through its `index.ts` or `contract.ts`. Its private files stay private, including their types. A client can import only public contracts. Contracts use Zod and other contracts; they do not import Node APIs, server implementation, or Pi types. The contract is owned by its feature, not by a global contracts file.

The platform contains shared mechanisms, not feature policy. It cannot import features. Features cannot import `app.ts` or `main.ts`. Dependencies are explicit function arguments or constructor arguments. Do not use a global service locator, dependency-injection container, or event bus to hide direct dependencies.

### Data ownership

One database connection can serve several features. This does not make one module the owner of all storage. Each feature defines its own tables and queries in its repository. Other features request operations through the owning feature's public interface, not SQL against its tables.

The platform opens and closes SQLite. It contains no feature tables or schema changes. The credentials module owns the key file and encryption. Accounts own password hashes and login sessions. Permissions own saved rules. Pi Durable remains the storage authority for harness messages and tasks; do not add a second message repository beside it.

Coordinate operations that cross features through explicit public operations. Do not move their implementations into the composition root. Design a transaction or recovery contract when a cross-feature operation requires it; a sequence of calls is not automatically atomic.

### Enforcement and change locality

Dependency Cruiser rejects private cross-feature imports, unsafe contract dependencies, client imports of server code, circular dependencies, and feature-aware platform code. Rules include type-only dependencies. New feature folders are discovered automatically.

Only `lifecycle/supervisor.ts` can import `child_process` in production. Its private command interface accepts fixed launchctl and systemctl operations with argument arrays and no shell. This exception does not expose host execution to models or other features. VM execution stays forbidden everywhere. The platform database module remains the only SQLite driver owner, including the technical process-lock mechanism.

Architecture tests exercise allowed and forbidden imports in temporary projects. They also check the server layout and the no-comments rule. Biome rejects focused and skipped tests. `npm run check` runs these checks with types, behavior tests, the build, and E2E tests. CI runs the same command.

An internal change to messages should normally change only `src/server/messages/`. A public API change can also change clients. A new feature can change application wiring. These are explicit dependencies, not reasons to duplicate logic for a smaller-looking diff.

Static checks cannot prove table ownership, good domain boundaries, or the absence of equivalent duplicate implementations. Review these properties. Changes to the architecture or its guardrails require David's approval. Tests and documentation must not claim a guarantee that the tools cannot enforce.

## Web modules

The web app uses feature ownership too. `main.tsx` composes the application. Each feature exposes `index.ts` or `index.tsx`; its other files are private.

```text
src/web/
  main.tsx                   Application entry and phase selection
  accounts/                  Setup, sign-in, key recovery, and sign-out
  models/                    Provider connections and model defaults
  messages/                  Conversation state, transcript, and composer
  settings/                  Settings dialog composition
  components/                Application-independent UI
    upstream/                Copied AI Elements and shadcn/ui sources
  platform/                  Shared technical hooks
  globals.css                Tailwind setup and base resets
  theme.css                  Semantic light and dark palettes
```

AI Elements owns the chat primitives: message rendering, conversation scrolling, and prompt input. shadcn/ui owns ordinary controls and dialogs. Clef's feature components connect them to its existing HTTP/SSE API. Do not introduce a second chat transport or a client-side agent loop.

Shared UI cannot import application code, including API clients and server contracts. Web platform code cannot import web features. Dependency Cruiser checks these rules and private feature imports. Tests check feature entry points and CSS placement. Use local utility classes or colocated CSS modules, not a global file of feature selectors.

Copied source versions, licenses, and integration changes are recorded in [UPSTREAM.md](src/web/components/upstream/UPSTREAM.md). Upstream comments and function complexity have a narrow exception. Clef-owned functions have a cognitive-complexity limit of 15. All copied code remains subject to types, other lint rules, boundaries, and runtime tests.

## Client interface

Clef defines its own API. The web app uses this API to talk to the running server. Planned desktop and mobile apps will use the same API. Local use does not require a gateway.

The web app is a first-class agent interface for desktop browsers, not only a management console. Users can talk to the agent without a separate desktop app. Agent work runs in the server, not the browser.

Use the web app as the minimum agent interface and the interface for testing agent behavior. Do not maintain a separate CLI chat client. Clients do not run an agent loop or open Pi Durable storage. `src/client/api.ts` contains the browser-safe HTTP request helper used by the web app.

Keep the API independent of Pi Durable's internal event and storage formats. The server maps client requests and updates to the harness. Clients must not depend on the harness's internal types.

### Local HTTP and conversation lifecycle

The first server binds to IPv4 loopback. It accepts only its local host names and rejects foreign browser origins. Setup needs a random token carried in the URL fragment and a request header. The fragment is not sent in normal page requests. Password attempts are rate-limited.

Sessions use random tokens. SQLite stores token hashes, not raw tokens. Browser cookies are HTTP-only and SameSite Strict, with a seven-day lifetime. The local HTTP cookie is not suitable for remote deployment. Logout revokes the session and closes its active response streams. SSE connections renew at least once per minute, which also rechecks expired sessions.

The app and API expose one persistent conversation. The server opens the most recently created stored conversation, or creates one if none exists. Older stored conversations remain unchanged but are not exposed. There are no create, list, or switch operations for clients, and no conversation selection in the URL.

Conversation commands use HTTP JSON at `/api/conversation`. SSE sends validated full snapshots, so a reconnect does not depend on an in-memory event history. Send requests carry an ID for duplicate prevention. Saved model and thinking settings apply to the next message. An active reply keeps its current settings. Stop cancels active work but cannot undo completed actions.

The browser renders Markdown without raw HTML and does not automatically fetch model-supplied external images. These controls reduce specific risks; they are not a complete security guarantee.

## Code execution and permissions

Use `@earendil-works/pi-codemode` for model-written JavaScript. It runs QuickJS compiled to WebAssembly in a worker thread. This is a language sandbox, not an OS VM. The worker thread keeps script execution off the server's main event loop; the restricted runtime and checked host calls enforce access limits.

Scripts have no direct Node APIs, filesystem, network, or server credentials. They can compose only the native and MCP tools that Clef exposes. Validate arguments and check permissions on every host call, including calls inside loops or parallel scripts. Do not rely on tool schemas or approval of the outer script to enforce access.

Deny external access by default. When an action has no applicable permission, keep it blocked and ask the user. Show the requested action, destination, and permission scope through the Clef API. Offer these choices:

| Choice | Effect |
| --- | --- |
| Deny | Reject the pending action without saving a rule. |
| This time | Allow this pending action only, not the whole script. |
| Always | Save an allow rule for the scope shown. |
| Never | Save a deny rule for the scope shown. |

Store persistent permission rules in configuration files. Let the user inspect and revoke them. Editing a file cannot grant a script access; activation must enforce the user's authorization. Scripts cannot grant themselves access. Bind each approval to the pending action; reject approvals for cancelled or expired actions.

Check network destinations and redirects before sending requests. Do not treat approval of an MCP server URL as approval of every tool it provides. Clef can restrict which MCP calls it sends, but it cannot enforce its local sandbox rules inside an independent MCP server.

Keep the tool registry empty until the required bounds are available and tested. Set explicit limits for script time, memory, output, and host-call work. Apply output limits before host buffering, not only after an execution returns. Permission waits must also expire. Stopping a script must cancel pending approvals and signal active tools to stop. Cancellation does not undo completed external actions. Do not blindly replay an interrupted script that may have caused side effects.

### Future VM workers

Add VM workers for tasks that need a browser, computer control, or a separate OS isolation boundary. The main agent delegates a bounded task to a subagent in the VM and receives its result and artifacts. Keep ordinary work in-process when a restricted runtime and checked tools can meet its needs.

Give each worker only the task data and capabilities it needs. Do not inherit the server's credentials, environment, or complete file workspace. Apply Clef's permission policy to delegation and granted access. A VM protects an execution boundary; it does not make actions on exposed files or signed-in accounts safe.

VM workers are not required for the first MVP. Direct host computer use remains a separate future capability.

## Host environment

The host environment contains the server and the resources available to it. It is one of two types:

| Installation | Host environment | Examples |
| --- | --- | --- |
| Container | A Linux container | Docker on Linux; Docker through OrbStack on macOS; Docker on a DigitalOcean Linux VM |
| Direct | A Linux or macOS environment, without a Clef container | A personal computer or a cloud VM |

For a container installation, “host environment” means the container, not the computer that runs it. A container is not a VM. Docker on Linux shares the Linux kernel. On macOS, Linux containers run through a Linux VM.

Clef has no direct Windows installation path.

## Storage

Use local SQLite for structured runtime state, including accounts, sessions, traces, analytics events, messages, and encrypted secrets. Also store the task state that Pi Durable needs. Use Pi Durable's SQLite adapter for harness state. One server process owns the database. The canonical process entry holds a kernel-released SQLite transaction lock before it opens application data. A separate lock serializes lifecycle commands. These locks do not own feature tables or replace Pi Durable storage. Clients access the database only through the Clef API.

Keep skills, active projects, second-brain notes, and other files in a file workspace. Use an ordinary folder for direct installation or a mounted folder or volume for a container. Keep the database separate from the file workspace.

The database, configuration files, and file workspace must persist when the container is replaced. Backups must include all three. Use a SQLite-safe backup method; do not copy only the main database file while it is active.

### Configuration files and live activation

File-backed configuration and live activation are planned. The current implementation stores model defaults, the Ollama server URL, and saved permission rules in SQLite.

Non-secret configuration files are the source of truth. The agent can read and edit them through scoped file tools. Feature modules still own their configuration schemas and rules. Do not maintain a competing settings store in SQLite.

Configuration files contain generic secret references, never secret values. Keep credentials in one shared encrypted secret store. Trusted server code resolves a reference only for an authorized operation. Possession of a reference does not grant permission to read the secret or send it to an arbitrary destination. Do not copy secrets into extension settings, generated code, or model context.

Load changed configuration lazily. Prepare and validate a replacement while the current version remains active. Activate only a complete, valid replacement. Keep the current valid version when preparation fails. Configuration reloads must not restart the server or break client connections. Keep authentication, permission enforcement, and durable storage ownership outside the replaceable configuration.

## Secrets and account access

The account password controls sign-in. The installation encryption key protects stored secrets. These are separate credentials. A password change must not change the encryption key or make secrets unreadable.

- Store only a salted password hash, using a maintained password-hashing library.
- Encrypt secret values before writing them to SQLite. Use authenticated encryption from a maintained cryptographic library.
- During setup, accept a valid encryption key or generate one with a secure random generator. Show it for copying during setup only. Ask the user to save a recovery copy.
- Keep the server's key copy in protected host storage, outside SQLite and the file workspace. Preserve it across container replacement. Load it automatically at startup.
- Never write the key or provider credentials to traces, analytics events, application logs, or model context. Do not store provider credentials in a plaintext Pi `auth.json` file.

If an existing installation cannot load its key, keep secret-dependent work blocked. Report the problem and allow recovery. Do not generate a replacement key or treat the installation as new.

In-process tool implementations are trusted server code. They must validate model-supplied inputs and must not expose the encryption key or raw provider credentials to the model. An in-process extension has server privileges; its tool interface is not a sandbox.

Run model-written JavaScript only in the restricted runtime. Do not evaluate it in the host JavaScript environment or import untrusted extensions as server code. The sandbox and its host interfaces must prevent access to the key, credential storage, and server memory outside the guest runtime. A separate folder or worker thread alone does not provide this protection. Do not pass server secrets into guest code or delegated worker environments.

Back up the encryption key separately from database exports. Restoring encrypted secrets requires the original key. Showing the key once in the UI does not mean that a host administrator cannot retrieve the server's copy.

This design protects encrypted secrets in a copied database. It does not protect them from a compromised running server. It does not encrypt messages, traces, or workspace files. It is not end-to-end encryption.

## First startup and setup

```mermaid
flowchart TD
    start["Start server"] --> configured{"Setup complete?"}
    configured -->|No| setup["Setup mode · Print setup link"]
    setup --> account["Step 1 · Username, password, encryption key"]
    account --> provider["Step 2 · Add model provider"]
    provider --> defaults["Apply Clef model and thinking defaults"]
    defaults --> ready["Ready"]
    configured -->|Yes| key{"Stored key available?"}
    key -->|Yes| ready
    key -->|No| locked["Recovery required · Block secret-dependent work"]
```

`clef` starts a native user-session service and returns after the server is ready. launchd manages macOS installations; systemd's user manager manages Linux installations. Both invoke the same `clef serve` foreground entry. Development also uses this entry. The service persists beyond the launching terminal and starts with the user session. It is not a privileged boot service.

The lifecycle module owns service registration and private startup metadata. The account feature still owns setup. The composition root supplies the existing account-dependent web address to the lifecycle module. A private Unix socket gives that address to the CLI after the HTTP listener is ready. The CLI checks the native PID too. Managed logs and public HTTP routes do not expose the setup token. See [installation and service controls](INSTALLATION.md).

When setup is incomplete, the CLI prints the protected web setup link. Keep onboarding short, with two steps:

1. **Account and encryption.** Default the editable username to the server's hostname. Ask for a password and encryption key. Provide a Generate button and a one-time copy view for the key.
2. **Model provider.** Add a cloud provider through sign-in or an API key, or connect a local Ollama server by URL. Apply the model and thinking level chosen by Clef for that provider.

Protect the setup link with a temporary, single-use setup token. A random visitor must not be able to claim the server. Disable setup access after completion. Do not admit agent work until setup is complete. Remote setup must use HTTPS or a secure tunnel.

## Model providers

Use Pi's `pi-ai` provider layer beneath Pi Durable. Keep provider credentials in Clef's encrypted secret store, including tokens obtained through sign-in.

| Provider | Access methods |
| --- | --- |
| OpenAI | Sign in with ChatGPT, or enter an OpenAI API key |
| OpenRouter | Sign in with OpenRouter, or enter an API key |
| Anthropic | Enter an API key for Claude |
| Ollama | Enter the local server URL; no user API key or stored credential |
| Other Pi providers | Use the access methods supported by the provider adapter |

ChatGPT subscription access and OpenAI API billing are different. Show that difference in setup. Provider sign-in must work when the browser and server are on different machines. Do not assume that a browser callback can reach the server through `localhost`.

Ollama discovery uses `/api/tags` and `/api/show`. The models feature registers the result with Pi's existing OpenAI-compatible adapter. Pi Durable remains the agent owner. The adapter receives the fixed non-secret client parameter `ollama`, as described in [Ollama's OpenAI compatibility documentation](https://docs.ollama.com/api/openai-compatibility). This is not an issued key or authentication. It is not saved in the credential store.

The models repository owns the Ollama URL. Startup discovers models again, with a ten-second deadline. A discovery failure keeps the URL and defaults and is shown in the model catalog. A failed replacement connection leaves the active connection unchanged. Connecting another provider never replaces existing defaults.

The URL is reached by the Clef server, not the browser. Unauthenticated HTTP is suitable only for a trusted network, not a public endpoint. Clef offers installed local chat models, not cloud aliases. Thinking controls come from Ollama's model metadata and use Pi's supported thinking-level map.

Clef defines a default model and thinking level for each supported provider. The [web settings](README.md#settings) offer only models and thinking levels supported by the selected provider connection. Preserve the user's choice; never silently switch providers.

## Data and access

- Store the database and file workspace on storage the user controls.
- Container tools can use resources made available to the container. Mounts and credentials can expose private data despite the container boundary.
- Direct installation has no container boundary. Tool access must still be restricted separately from server access. Any host resources granted to tools are exposed to agent actions.
- The user selects a local or cloud model. A cloud model receives the context sent to it. Never silently switch from local to cloud inference.
