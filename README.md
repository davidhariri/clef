# Clef

An excellent personal AI assistant that runs on computers you control.

We’re building a capable assistant with simple desktop and mobile apps, without giving up control of your data. Run it on your own machine or a server in your cloud account.

## What we’re building

- A TypeScript server with a web UI for setup and management.
- Open-source desktop and mobile apps for working with your assistant.
- Support for local and cloud models, chosen by you.
- A small agent core that you can extend with new capabilities.

This repo focuses on the server and management UI.

## Architecture

The core coordinates conversations, model calls, and tools. An isolated Linux VM provides the agent’s working computer: browser, shell, and files.

Self-hosting does not hide data from a cloud model you choose to use. Clef must make that data flow clear and never silently switch from local to cloud inference.

See [INTENT.md](INTENT.md) for the project’s goals and constraints.
