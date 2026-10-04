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

The npm package contains the built server, web app, and this guide. Installation needs no lifecycle scripts or source checkout.

`clef` registers the native service and waits for the server to become ready. It then prints the existing web setup link and exits. Open that link to create your account, save your recovery key, and connect a model provider. Clef does not open a browser automatically.

The setup link contains a temporary credential. Do not share it. Managed service logs do not contain it. Run `clef` again to get the current link. After account creation, this command prints the ordinary web address instead.

## Controls

| Command | Result |
| --- | --- |
| `clef` or `clef start` | Start the managed server. If it is already ready, return its existing web address without starting another server. |
| `clef status` | Report whether the managed server is running, stopped, or not ready. A not-ready service returns a nonzero exit status. |
| `clef stop` | Stop the managed server and remove its automatic-start configuration. Preserve the account, key, workspace, and other data. |
| `clef serve` | Run the same server in the foreground without registering a native service. Use this for development or an externally managed process. |

To restart, run `clef stop`, then `clef`. A concurrent lifecycle command can fail with an ownership message. Wait for the first command to finish, then retry.

Do not run a foreground server and a managed service against the same data directory. Clef uses a process lock to reject a second owner, even on another port. Never delete or replace an active lock file. The operating system releases its lock if the process exits or crashes.

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

The data directory is owner-only. Lifecycle records, sockets, locks, logs, and service configuration are owner-only too. Readiness and the setup link travel through the private local socket, not an unauthenticated HTTP endpoint. The existing loopback, host, origin, account, and key protections still apply. This does not protect data from other code running as the same user.

## Update or remove

Stop Clef before an update:

```sh
clef stop
npm install -g @davidhariri/clef@latest --ignore-scripts
clef
```

For a separate installation, apply its `CLEF_HOME` and `CLEF_PORT` to the lifecycle commands. The account, encryption key, provider settings, and workspace stay in the data directory.

To remove the executable, run `clef stop` before `npm uninstall -g @davidhariri/clef`. This leaves your data in place. Do not delete that data unless you intend to remove the installation permanently. Back up the database safely and keep the encryption key with your recovery material.

## Troubleshooting

- **Native service manager unavailable:** Use a macOS desktop session or a Linux systemd user session. Check the user bus on Linux. Clef does not fall back to a detached shell process or request elevated privileges.
- **Port in use:** Stop the other server yourself, or choose another `CLEF_PORT`.
- **Another owner or configuration conflict:** Check which installation or foreground process owns the resource. Do not remove its lock or configuration to force startup.
- **Not ready or startup failed:** Read `service.log`. Inspect the named service with `launchctl print gui/$(id -u)/<service-name>` on macOS or `systemctl --user status <service-name>.service` on Linux. Stop it with `clef stop`, correct the reported problem, then start it again.

Clef waits for both native process state and private server readiness before reporting a successful start. Failed startup removes its automatic-start configuration when the native manager is reachable. If the manager itself fails during cleanup, inspect the named test or user service before retrying; do not reset user-wide service settings.
