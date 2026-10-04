# Clef

> [!WARNING]
> Clef is still early in its development. Some things may be broken or too permissive. Ye been warned!

Clef is a general-purpose AI assistant that runs on computers you control. It's fast, fun and puts ownership of your agent enitrely in your hands.

## Installation

Use Node.js 24 LTS or newer on macOS or Linux with a native user-session service manager.

```sh
npm install -g @davidhariri/clef@latest --ignore-scripts
clef
```

Open the setup link printed in your terminal. Create your account, save your recovery key, and connect a model provider. The package includes the built server and web app; installation does not need scripts or a source checkout.

Clef runs in the background and starts with your user session. You can close the terminal. Use `clef status` to check it and `clef stop` to stop it and disable automatic startup. These commands preserve your data.

See [service controls, updates, and advanced configuration](INSTALLATION.md).

## Why Clef over Meta's Muse, XAI's Grokbot, or OpenAI's Dot?

These are great products. Useful AI personal assistants are effectively operating systems for their users. Maybe i'm just old now, but I feel uneasy about giving over so much of my information to systems I can't control or easily leave should I want to.

1. **Control** - Your data is stored and used in an environment you fully control.
2. **Privacy** - You choose your inference provider. A cloud provider receives the context sent to it. Use Ollama for local inference.
3. **Portability** - You can change models and providers. Your data stays on storage you control. Agent-assisted migration is planned.

## Why use Clef over OpenClaw, Nanoclaw or Hermes?

Those projects are awesome. So awesome that they are overwhelming! At least to me. I am aiming to build something that feels as approachable as the frontier labs products but without all the perverse incentives.

## Local models with Ollama

In setup or **Settings > Manage connections**, select **Use local Ollama**. Enter the server URL, for example `http://localhost:11434` or `http://macstudio.local:11434`. Use the server root URL, without `/v1`. No API key is needed. Clef does not install Ollama or download models.

The **Clef server**, not your browser, must be able to reach this URL. `localhost` means the computer that runs Clef. The selected Ollama server receives your conversation. Use unauthenticated HTTP only on a trusted network, never on a public endpoint. The internal OpenAI-client placeholder is not authentication and does not secure Ollama.

Clef discovers installed local chat models. Embedding models and cloud aliases are not offered. Use an Ollama version that reports `thinking.values` from `/api/show` for thinking models. Only supported Clef thinking levels are offered. For boolean-only thinking controls, `medium` turns thinking on and `off` turns it off.

Choose a model and thinking level in **Settings > Models > Default**. Changed defaults apply only to new conversations. The server URL and defaults survive restarts. Changing the server URL changes the destination for all Ollama conversations. Connect again to refresh the installed model list. Clef also discovers models at startup; a discovery failure keeps your settings and is shown in Settings. Clef never switches providers to recover from a failure.

## Features

- **Local setup** - Install it on a macOS or Linux computer you control. Docker packaging and remote access are planned.
- **Self-extension (planned)** - Clef will be able to write extensions and small scripts. Code execution is disabled until resource limits are enforced.
- **Self-configuration** - Clef can inspect model settings and request a model-default change. Approve changes in web chat, with an optional switch of that conversation. Connect providers through web settings. See [configuration limits](ARCHITECTURE.md#configuration-files-and-live-activation).

## License

Clef-owned code uses [MIT](LICENSE). Third-party components retain their own licenses.

## More

Nerd? read [ARCHITECTURE](ARCHITECTURE.md)

## Contributing (are you an AI agent?)

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md). Use Biome for formatting and linting. Follow the [check policy](CONTRIBUTING.md#check-a-change) for code and documentation changes.

See [INTENT.md](INTENT.md) for the project’s goals and constraints.
