# Clef

An excellent personal AI assistant that runs on computers you control.

We’re building a capable assistant with simple desktop and mobile apps, without giving up control of your data. Run it on your own machine or a server in your cloud account.

## What we’re building

- A TypeScript server with a web app for chat, setup, and management.
- Open-source desktop and mobile apps for working with your assistant.
- Support for local and cloud models, chosen by you.
- A small agent core that you can extend with new capabilities.

This repo focuses on the server and web app.

## Installation paths

The server will support two installation paths:

1. **Container:** Run a Linux container with Docker. Use Docker on Linux, OrbStack on macOS, or a Linux cloud VM such as a DigitalOcean Droplet.
2. **Direct:** Run the server on Linux or macOS without a container.

Direct installation can expose local files and software to agent tools. It puts more of your computer and data at risk. Containers also need careful limits on mounted files and credentials.

There is no direct Windows installation path.

## Run locally

Use Node 24 LTS on Linux or macOS.

```sh
npm ci
npm run build
npm start
```

Open the link printed by the server. Clef listens only on `127.0.0.1:3737`.

- `CLEF_HOME` changes the data directory. The default is `~/.local/share/clef`.
- `CLEF_PORT` changes the local port.
- Run one server per data directory. Stop it before making a filesystem backup.

## Setup

On first start, the server prints a protected link to web setup:

1. Set your username, password, and encryption key. You can generate the key and copy it once. Save a recovery copy.
2. Connect a model provider through sign-in or an API key.

The server unlocks stored secrets automatically after restarts. Your account password and encryption key are separate.

Review the default provider, model, and thinking level at **Settings > Models > Default** before your first message. Use **Manage connections** to add or replace provider credentials.

## Architecture

The TypeScript server manages conversations, model calls, and tools. The web app connects through the Clef API. Planned desktop and mobile apps will use the same API. See the [system diagram](ARCHITECTURE.md).

Clef uses Pi Durable for agent work. Pi Codemode is selected for restricted JavaScript execution; execution must stay disabled until all resource limits are enforced. Scripts will call permission-checked tools, without direct access to the host shell. Work will stay in-process where possible. Future VM workers will handle delegated tasks that need a browser, computer control, or a separate OS isolation boundary.

Clef will store messages, traces, analytics events, encrypted secrets, and other runtime state in local SQLite. Non-secret configuration will use files with references to the shared secret store. Skills, projects, notes, and other files will live in a folder or volume you control.

Self-hosting does not hide data from a cloud model you choose to use. Clef must make that data flow clear and never silently switch from local to cloud inference.

The server is organized by feature. Each feature keeps its API, behavior, storage, and tests together behind a small public interface. See [Server modules](ARCHITECTURE.md#server-modules) for ownership and dependency rules.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). Use Biome for formatting and linting. Follow the [check policy](CONTRIBUTING.md#check-a-change) for code and documentation changes.

See [INTENT.md](INTENT.md) for the project’s goals and constraints.
