# Installation and service controls

## Requirements

Use Node.js 24 LTS or newer and npm. Install Clef as your ordinary user, not as root.

- **macOS:** Sign in to a desktop user session. Clef uses a launchd LaunchAgent in that session.
- **Linux:** Use a systemd user manager and its user D-Bus connection. `systemctl --user show-environment` must succeed in the terminal where you run Clef.

Clef does not install a system-wide service or change Linux lingering. Automatic startup means startup with your user session, not startup before login. User-session policy controls what happens at logout. Closing the launching terminal does not stop the service. Direct Windows support and container packaging are not provided.

## Install and start

```sh
npm install -g @davidhariri/clef@latest --ignore-scripts
clef
```

The npm package contains the built server, terminal client, and this guide. Installation needs no lifecycle scripts or source checkout.

`clef` starts or attaches to the native service and opens terminal chat. The first session opens Settings so you can connect a model provider. Local access uses your OS user; no Clef account is needed. Provider sign-in can require a browser, but Clef does not open one automatically.

Ctrl+D exits the TUI. The server continues to run. Use `clef start` when you want to start the server without opening chat.

## Controls

| Command | Result |
| --- | --- |
| `clef` | Attach to the local server, or start a managed server, then open chat. Requires an interactive terminal. |
| `clef --server <origin>` | Connect to another endpoint without starting a local service. |
| `clef start` | Start the managed server and return after readiness. Do not open chat. |
| `clef status` | Report whether the managed server is running, stopped, or not ready. A not-ready service returns a nonzero exit status. |
| `clef stop` | Stop the managed server and remove its automatic-start configuration. Preserve credentials, key, workspace, and other data. |
| `clef serve` | Run the same server in the foreground without registering a native service. Use this for development or an externally managed process. |

To restart, run `clef stop`, then `clef`. A concurrent lifecycle command can fail with an ownership message. Wait for the first command to finish, then retry.

With the same `CLEF_HOME` and `CLEF_PORT`, `clef` can attach to a foreground server. Service controls still manage only the native service. Stop a foreground server with Ctrl+C in its own terminal.

Do not run a foreground server and a managed service against the same data directory. Clef uses a process lock to reject a second owner, even on another port. Never delete or replace an active lock file. The operating system releases its lock if the process exits or crashes.

## Remote connections

The server stays bound to loopback. Use an HTTPS reverse proxy or an SSH tunnel. Do not expose unencrypted HTTP to a LAN, tailnet, or the internet. A tailnet name alone does not prove transport encryption to Clef.

On the server host, open `/settings` → **Client access** → **Add client**. Name the client and save its token. The token is shown once. Each client must have its own token. Revoke it from the same menu if the device is lost.

With Tailscale Serve configured to proxy HTTPS to `http://127.0.0.1:3737`:

```sh
clef --server https://your-server.your-tailnet.ts.net
```

Configure Tailscale Serve and tailnet access rules yourself. Clef does not modify them. Do not use Tailscale Funnel to publish the server. Other HTTPS proxies must preserve Authorization, stream SSE without buffering, and use a certificate trusted by the client. Clef rejects redirects and does not offer an option to disable certificate validation.

For an SSH tunnel, run this in another terminal:

```sh
ssh -N -L 4737:127.0.0.1:3737 user@server
clef --server http://127.0.0.1:4737
```

The second command runs in your working terminal while the tunnel remains open. Paste the client token at the masked prompt. Tokens are saved privately for that exact origin, not passed as command-line arguments. Changing the URL requires a separate connection. An invalid or revoked token causes a new prompt on reconnect.

Remote clients can chat and change server settings. Only a locally authenticated client can manage client access. Closing a client does not stop remote agent work.

## Data and configuration

By default, Clef uses `~/.local/share/clef` and listens only on `127.0.0.1:3737`. Data stays outside the npm package.

| Setting | Purpose |
| --- | --- |
| `CLEF_HOME` | Select a separate installation and its data directory. |
| `CLEF_PORT` | Select its IPv4 loopback port. The default is `3737`. |

For example:

```sh
CLEF_HOME="$HOME/clef-test" CLEF_PORT=4747 clef
CLEF_HOME="$HOME/clef-test" CLEF_PORT=4747 clef status
CLEF_HOME="$HOME/clef-test" CLEF_PORT=4747 clef stop
```

Use the same settings for later commands. Stop the installation before changing its port. Clef rejects occupied ports; it does not stop another application to take its port.

The native configuration records the absolute Node executable, installed Clef entry path, data path, and port. It does not copy your terminal's environment or provider credentials. Keep that Node installation and npm prefix available. Stop and start Clef after moving or replacing either runtime path.

Each canonical data path has its own service name: `dev.clef.` followed by the first 24 hexadecimal digits of its SHA-256 hash. Symbolic links to the same data directory select the same installation.

- macOS configuration: `~/Library/LaunchAgents/<service-name>.plist`.
- Linux configuration: `${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/<service-name>.service`.
- Private lifecycle files: `service.json`, `control.sqlite`, `owner.sqlite`, and `runtime.sock` inside `CLEF_HOME`.
- Startup diagnostics: `service.log` inside `CLEF_HOME`. A new managed start resets this log.

Do not edit generated service configuration while Clef owns it. Clef refuses conflicting configuration rather than replacing it. Use a local filesystem with SQLite locking and Unix socket support. Keep the data path short enough for the host's Unix socket path limit. Installation paths cannot contain line breaks or null bytes.

The data directory is owner-only. Lifecycle records, sockets, locks, logs, and service configuration are owner-only too. Readiness and local authentication travel through the private socket, not an unauthenticated HTTP endpoint. Every API request requires a credential; browser-origin requests are rejected. This does not protect data from other code running as the same user.

## Update or remove

Stop Clef before an update:

```sh
clef stop
npm install -g @davidhariri/clef@latest --ignore-scripts
clef
```

For a separate installation, apply its `CLEF_HOME` and `CLEF_PORT` to the lifecycle commands. The encryption key, provider credentials, settings, conversations, and workspace stay in the data directory. This version removes web accounts and cookie sessions. Existing encrypted provider credentials keep their original key.

To remove the executable, run `clef stop` before `npm uninstall -g @davidhariri/clef`. This leaves your data in place. Do not delete that data unless you intend to remove the installation permanently. Back up the database safely and keep the encryption key with your recovery material.

## Backups and key recovery

Back up `settings.yaml`, the workspace, and SQLite with a SQLite-safe backup method. Keep a separate protected copy of `secrets/encryption.key`. The server creates this key only for a new installation. If the key is lost later, the TUI blocks secret-dependent operations and asks for the original key. Do not replace it with a new key.

`secrets/local-token` grants local administrative access. Remote tokens are stored on each client under `${XDG_CONFIG_HOME:-$HOME/.config}/clef/connections`. Protect these files like passwords. A client token is not an encryption recovery key.

## Troubleshooting

- **Incompatible readiness format:** An older or incompatible server is running. For a managed service, run `clef stop`. For a foreground server, stop it in its original terminal with Ctrl+C. Then start this version. From a source checkout, use `npm run chat`, which builds the launcher first. Do not delete your data or encryption key.

- **Native service manager unavailable:** Use a macOS desktop session or a Linux systemd user session. Check the user bus on Linux. Clef does not fall back to a detached shell process or request elevated privileges.
- **Port in use:** Stop the other server yourself, or choose another `CLEF_PORT`.
- **Another owner or configuration conflict:** Check which installation or foreground process owns the resource. Do not remove its lock or configuration to force startup.
- **Not ready or startup failed:** Read `service.log`. Inspect the named service with `launchctl print gui/$(id -u)/<service-name>` on macOS or `systemctl --user status <service-name>.service` on Linux. Stop it with `clef stop`, correct the reported problem, then start it again.

Clef waits for both native process state and private server readiness before reporting a successful start. Failed startup removes its automatic-start configuration when the native manager is reachable. If the manager itself fails during cleanup, inspect the named test or user service before retrying; do not reset user-wide service settings.
