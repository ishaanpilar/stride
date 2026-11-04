# Stride MCP Server

MCP server for Stride. Connect MCP clients (Claude Desktop, etc.) to your local SQLite database, the desktop Local API, or a self-hosted Stride Cloud endpoint.

By default this is a **stdio** server: MCP clients launch it as a subprocess and talk over JSON-RPC on stdin/stdout. It also has an opt-in **HTTP transport** (see [Remote access (HTTP)](#remote-access-http)) for self-hosters who want to expose it at a URL instead.

---

## App Binaries vs. MCP Helper

The desktop app includes a built-in MCP server in **Settings → Integrations → Local MCP server (advanced)**. It requires no separately installed runtime or helper. The desktop installer does not add a standalone `stride-mcp` command to your `PATH`; mobile apps do not host MCP.

You do **not** need to run the whole app from source to use MCP. You can use the normal desktop app binary for your tasks, then run this separate MCP helper from the repository with Bun, or build the helper once and run it with Node. Point the helper at the desktop app's local `stride.db`, or use the Local API backend below.

On desktop, find the database in the default database locations listed under [Requirements](#requirements). Mobile binaries do not expose a local MCP server surface.

---

## Requirements

These requirements apply to the standalone helper, not the built-in desktop server.

- Node.js 20+ to run the helper. Prefer Node.js 22+ for prebuilt SQLite binaries on supported platforms; Node 20 requires a native build toolchain.
- Node-based SQLite mode uses the optional better-sqlite3 native addon. API-only installs can omit it with `--omit=optional`. If no prebuilt binary is available for your platform, npm needs a working C/C++ build toolchain and Python for node-gyp.
- Bun (recommended for development in this repo)
- A local database (`stride.db`) for SQLite mode, a running desktop Local API and bearer token for API mode, or a self-hosted Stride Cloud URL and bearer token for Cloud mode

For **SQLite mode with npm 12**, approve the SQLite dependency's install script; otherwise a successful install can still fail at startup with a missing native binding. For `npx` or global installs, allow only `better-sqlite3`:

```bash
npx --allow-scripts=better-sqlite3 -y stride-mcp --db "/path/to/stride.db"
npm install -g --allow-scripts=better-sqlite3 stride-mcp
```

In MCP client configurations using `npx`, add `"--allow-scripts=better-sqlite3"` before `"stride-mcp"` in `args`. For an existing project-local install, run `npm install-scripts approve better-sqlite3`, then `npm rebuild better-sqlite3` from that project. Review the dependency before approving; do not enable all dependency scripts.

Default database locations. The installed Windows and macOS apps keep the database in a `data` subfolder from version 1.3.2 on; Linux and the portable builds are unchanged. The server looks in both places, so it finds the database either way.

- Linux: `~/.local/share/stride/stride.db` (Flatpak: `~/.var/app/com.ishaanpilar.stride/data/stride/stride.db`; Snap: `~/snap/stride/current/.local/share/stride/stride.db`)
- macOS, 1.3.2 and later: `~/Library/Application Support/stride/data/stride.db`
- macOS, 1.3.1 and earlier: `~/Library/Application Support/stride/stride.db`
- Windows, 1.3.2 and later: `%APPDATA%\stride\data\stride.db`
- Windows, 1.3.1 and earlier: `%APPDATA%\stride\stride.db`

Additional macOS paths for sandboxed builds:
- 1.3.2 and later: `~/Library/Containers/com.ishaanpilar.stride/Data/Library/Application Support/stride/data/stride.db`
- 1.3.1 and earlier: `~/Library/Containers/com.ishaanpilar.stride/Data/Library/Application Support/stride/stride.db`

A `--db` path pinned in an MCP client configuration keeps working across that move: if the file is not at the configured path, the server checks the matching `data` subfolder (or the parent folder) and reports on stderr which database it opened.

If `stride.db` is missing but `data.json` exists in the same desktop data folder, the MCP server will bootstrap a fresh SQLite database from that local data snapshot on first start.
The desktop data folder is the folder that holds `stride.db` in the default locations above.

You can override local mode with:
- `--db /path/to/stride.db`
- `STRIDE_DB_PATH=/path/to/stride.db`
- `STRIDE_DB=/path/to/stride.db`

For self-hosted Cloud mode, use:
- `--cloud-url https://stride.example.com` or `STRIDE_MCP_CLOUD_URL`
- `--cloud-token <token>` or `STRIDE_MCP_CLOUD_TOKEN`
- optional `--cloud-allow-insecure-http=true` for trusted private HTTP deployments

---

## Start / Stop

### Run from npm

After installing the published package, run it directly:

```bash
stride-mcp --db "/path/to/stride.db"
```

Or let an MCP client launch it through npx:

```json
{
  "mcpServers": {
    "stride": {
      "command": "npx",
      "args": [
        "-y",
        "stride-mcp",
        "--db",
        "~/.local/share/stride/stride.db"
      ]
    }
  }
}
```

The npm package is read-only by default. Add `--write` only when you explicitly want add/update/complete/delete tools enabled.

### Desktop Local API mode

> Requires stride-mcp 1.1.11 or later.

Enable the desktop app's **Local API** in Settings and copy its bearer token. Keep the app and API running. This backend uses the app's REST endpoints and never opens a database or falls back to SQLite.

For an API-only installation, omit the optional native SQLite addon:

```bash
npm install -g --omit=optional stride-mcp
```

Configure your MCP client to pass the token through its environment, rather than putting it in command-line arguments:

```json
{
  "command": "stride-mcp",
  "args": ["--api-url", "http://127.0.0.1:3456"],
  "env": {
    "STRIDE_MCP_API_TOKEN": "<token from desktop settings>"
  }
}
```

Use the port shown in Settings. `STRIDE_MCP_API_URL` can replace `--api-url`. URLs must use literal `127.0.0.1` or `[::1]`, with no credentials, path, query or fragment; redirects are refused. Do not combine API and Cloud/`--db` options. Existing database-path environment variables are ignored in API mode.

Writes remain disabled unless explicitly enabled with `--write`. If the app is closed or the token is invalid, the helper returns an error. A timed-out write may have reached the app: inspect the task before retrying, as the helper does not retry writes automatically.

| MCP capability | Desktop Local API support |
| --- | --- |
| List/get tasks | Supported, including rich search operators, date filters, sorting and pagination |
| Create tasks | Explicit title and fields; `quickAdd` is unavailable |
| Update/complete/delete/restore tasks | Supported through the API's corresponding endpoints; terminal status changes cannot be submitted as ordinary edits |
| List/get/create/update/delete projects | Supported for the API's basic project fields: title, color, status, Area and sequential behavior |
| List areas | Supported |
| View section catalogue and project assignments | Unavailable; task assignments by known ID are supported |
| Sections, managed people, Area writes | Unavailable; these tools are hidden in API mode |
| GTD availability `view` | Unavailable because the API does not expose the required section snapshot |
| Replacing attachment links | Unavailable because the API does not provide conditional attachment updates |

Other unsupported fields are rejected before a write. The desktop API's recurrence limitations also apply; some recurring completions must be performed in the app. This backend does not promise full SQLite/Cloud tool parity.

`--api-url` selects the helper's **data source**. `--http` instead selects how an MCP client connects **to the helper**; it can be used with any backend and has a separate authentication token.

### Self-hosted Cloud mode

Use Cloud mode when you run your own Stride Cloud server and want MCP tools without pointing the helper at a local SQLite database:

```bash
npx -y stride-mcp \
  --cloud-url "https://stride.example.com" \
  --cloud-token "$STRIDE_TOKEN"
```

Or pass the same values through environment variables:

```bash
STRIDE_MCP_CLOUD_URL="https://stride.example.com" \
STRIDE_MCP_CLOUD_TOKEN="$STRIDE_TOKEN" \
npx -y stride-mcp
```

Cloud mode uses the self-hosted Cloud API. Reads come from the current `/v1/data` snapshot; with `--write`, task/project/section/area writes go through the Cloud server's per-resource REST endpoints (`POST /v1/tasks`, `PATCH /v1/tasks/:id`, and so on), so they get the same validation and revision stamping as any other client. Without `--write`, write tools return `read_only`. Person edits and restoring deleted tasks are not available in Cloud mode yet.

This does not make Stride Cloud itself a hosted MCP server. It is still the same stdio helper, backed by a Cloud URL that you operate.

For private HTTP test deployments, local/private HTTP URLs are allowed by the shared Cloud client rules. Use `--cloud-allow-insecure-http=true` only for a self-hosted endpoint you intentionally trust.

### Remote access (HTTP)

By default `stride-mcp` only speaks stdio. Pass `--http` to also (instead of stdio) serve a stateless streamable-HTTP MCP endpoint, so you can point a remote MCP client at a URL — the motivating case is [Gemini Spark](https://gemini.google.com) "custom apps", which take an MCP server URL. HTTP mode works with all three backends.

```bash
stride-mcp --http --http-token "$(openssl rand -hex 32)" --db "/path/to/stride.db"
```

Flags (all have `STRIDE_MCP_HTTP*` env var equivalents):

- `--http` / `STRIDE_MCP_HTTP` — enable HTTP mode. Also implied by setting `--http-host`, `--http-port`, or `--http-token`.
- `--http-token <token>` / `STRIDE_MCP_HTTP_TOKEN` — **required** whenever HTTP mode is on, at least 16 characters. Generate one with `openssl rand -hex 32`. The server refuses to start without it — there is no way to expose HTTP mode unauthenticated, even on loopback.
- `--http-host <host>` / `STRIDE_MCP_HTTP_HOST` — bind address, default `127.0.0.1`.
- `--http-port <port>` / `STRIDE_MCP_HTTP_PORT` — bind port, default `8722`.

The desktop app's built-in MCP server also uses port `8722`. If it is on, pass another port with `--http-port`, for example `--http-port 8723`.

The MCP endpoint is `POST /mcp` and requires `Authorization: Bearer <token>` on every request; `GET /healthz` returns `200 ok` without auth for reverse-proxy health checks. Requests without a valid token get `401`; repeated authentication failures get `429` with a `Retry-After` header. Bodies over 1 MiB get `413`. When HTTP mode is on, the server does not also connect a stdio transport — it stays alive as long as the HTTP server is listening, not stdin.

There is no built-in TLS termination or rate limiting for authenticated requests. If you're exposing this beyond localhost, put a reverse proxy (e.g. Caddy, nginx) in front for TLS and put the resulting `https://` URL (plus your token) into the remote MCP client.

### Run directly from the repo

```bash
# from repo root (read-only by default)
bun run stride:mcp -- --db "/path/to/stride.db"
```

Enable writes (required for add/update/complete/delete tools):

```bash
bun run stride:mcp -- --db "/path/to/stride.db" --write
```

Stop:
- Press `Ctrl+C` in the terminal.

### Keep-alive behavior (why it sometimes exits)

The MCP server is **stdio‑based**. It stays alive as long as stdin is open.
If your shell/client closes stdin, the process exits.

To force an immediate exit when stdin closes (no keep-alive), pass `--nowait`:

```bash
bun run stride:mcp -- --db "/path/to/stride.db" --nowait
```

Note: When an MCP client launches the server, it keeps stdin open, so the server should remain connected.

### Run without the helper script

```bash
bun run --filter stride-mcp dev -- --db "/path/to/stride.db"
```

Stop:
- Press `Ctrl+C` in the terminal.

### Build and run the binary entry (Node)

```bash
# from repo root
bun run --filter stride-mcp build
node apps/mcp-server/dist/cli.js --db "/path/to/stride.db"
```

Stop:
- Press `Ctrl+C` in the terminal.

---

## Why `stride-mcp` is “command not found”

`stride-mcp` is the package binary. It exists after installing the npm package globally, after an MCP client launches it through `npx`, or after you build the source package and run it with Node.

Use one of these source-tree options instead:

```bash
# ✅ works immediately
bun run stride:mcp -- --db "/path/to/stride.db"

# ✅ build then run
bun run --filter stride-mcp build
node apps/mcp-server/dist/cli.js --db "/path/to/stride.db"
```

### Optional: create a global `stride-mcp` command

If you want a real `stride-mcp` command on your PATH, create a tiny wrapper:

```bash
cat > ~/bin/stride-mcp <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd /absolute/path/to/Stride
exec bun run stride:mcp -- "$@"
EOF
chmod +x ~/bin/stride-mcp
```

Then use:

```bash
stride-mcp --db "/path/to/stride.db"
```

### Desktop app toggle?

The desktop app has **Settings → Integrations → Local MCP server (advanced)**. Access is disabled and read-only by default. Enable it and copy connection details for a client supporting authenticated Streamable HTTP. The default endpoint is `http://127.0.0.1:8722/mcp`; **Advanced** lets you choose a port from 1024 to 65535. Save the port, then update your client's connection details. The server remains bound to loopback.

Starting with v1.3.7, **Allow task and project edits** permits creating, editing, completing, and restoring tasks, and creating or editing projects. **Advanced** has separate **Allow archiving** and **Allow deletion** permissions. Each permission is independent; all start off on a new installation. Existing installations that enabled **Allow changes** retain their previous deletion permission, which can now be disabled separately. Archiving requires an explicit new grant. Updates that combine ordinary edits with archive/cancellation changes require both permissions. The dedicated `stride_archive_task` tool uses the app's archive operation without completing the task or generating a recurring occurrence. Deletion remains soft deletion.

**Copy for Codex** provides TOML for `~/.codex/config.toml`. Add or replace the `mcp_servers.stride` entry while preserving your other configuration; Stride does not edit that file. **Copy connection details** retains the JSON format for clients using `mcpServers`. Both include a private bearer token. Connected AI clients can read exposed Stride data and may send it to their provider. Regenerating the token disconnects old clients.

The built-in server runs inside the desktop app and shares its task and project operations with the Local API. You do not need to enable the Local API. Closing to the tray keeps it running; disabling MCP or quitting stops it. A startup failure or occupied port is shown in Settings with Retry. This mode does not provide remote ChatGPT access, a tunnel, or hosting. The standalone helper's backend-specific capabilities and `--write` flag are separate from these desktop permissions.

Source builds compile the built-in server with the desktop Rust application; no separate MCP executable or runtime is bundled.

---

## MCP Client Configuration

MCP clients run the server as a subprocess. You point them to **the command** and pass args/env.

**Important:** Do NOT use `bun run stride:mcp` for MCP clients. The `bun run` wrapper outputs shell messages to stdout (e.g., `$ bun run --filter...`) which breaks the JSON-RPC protocol. Always run bun directly on the source file.

### Example (generic MCP config)

```json
{
  "mcpServers": {
    "stride": {
      "command": "bun",
      "args": [
        "/absolute/path/to/Stride/apps/mcp-server/src/cli.ts",
        "--db",
        "~/.local/share/stride/stride.db"
      ]
    }
  }
}
```

Add `--write` to the args if you want to enable **add/update/complete/delete** tools.

If your client doesn't support Bun, build first and use Node:

```bash
# Build once
cd /path/to/Stride && bun run --filter stride-mcp build
```

```json
{
  "mcpServers": {
    "stride": {
      "command": "node",
      "args": [
        "/absolute/path/to/Stride/apps/mcp-server/dist/cli.js",
        "--db",
        "~/.local/share/stride/stride.db"
      ]
    }
  }
}
```

Add `--write` to the args if you want to enable **add/update/complete/delete** tools.

### Claude Desktop

Claude Desktop supports MCP (stdio). Add a server entry in its MCP configuration.

Typical config file locations:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

After editing, fully quit and relaunch Claude Desktop.

### Claude Code (CLI)

Add a server via the CLI:

```bash
claude mcp add stride -- \
  bun /path/to/Stride/apps/mcp-server/src/cli.ts --db "/path/to/stride.db" --write
```

Or edit `~/.claude.json` directly:

```json
{
  "projects": {
    "/path/to/your/project": {
      "mcpServers": {
        "stride": {
          "type": "stdio",
          "command": "bun",
          "args": [
            "/absolute/path/to/Stride/apps/mcp-server/src/cli.ts",
            "--db",
            "~/.local/share/stride/stride.db",
            "--write"
          ]
        }
      }
    }
  }
}
```

Then restart the Claude Code session and run `/mcp` to verify it's connected.

### OpenAI Codex (config.toml)

Codex stores MCP config in `~/.codex/config.toml`. Add:

```toml
[mcp_servers.stride]
command = "bun"
args = ["/absolute/path/to/Stride/apps/mcp-server/src/cli.ts", "--db", "/path/to/stride.db", "--write"]

# Optional: pass env vars to the server
[mcp_servers.stride.env]
STRIDE_DB_PATH = "/path/to/stride.db"
```

Restart Codex after saving.

### Gemini CLI

Gemini CLI uses a JSON `settings.json` with `mcpServers`, either:
- User scope: `~/.gemini/settings.json`
- Project scope: `.gemini/settings.json` in your repo

You can add Stride MCP two ways:

**1) CLI (recommended):**

```bash
gemini mcp add stride \
  bun /absolute/path/to/Stride/apps/mcp-server/src/cli.ts \
  --db "/path/to/stride.db" --write
```

**2) Edit settings.json manually:**

```json
{
  "mcpServers": {
    "stride": {
      "command": "bun",
      "args": ["/absolute/path/to/Stride/apps/mcp-server/src/cli.ts", "--db", "/path/to/stride.db", "--write"]
    }
  }
}
```

Restart the Gemini CLI session after saving.

### Other MCP clients

Any MCP-compatible client can work as long as it can launch a **stdio** server with the command + args above.

---

## Migration: tool rename (`stride.*` → `stride_*`)

> **Breaking change** (introduced in this release): all tool names have changed from dot-notation (`stride.list_tasks`) to underscore-notation (`stride_list_tasks`) to comply with MCP client validation rules (e.g. Claude Desktop).

**Old → new mapping:**

| Old name                  | New name                   |
| ------------------------- | -------------------------- |
| `stride.list_tasks`      | `stride_list_tasks`       |
| `stride.list_projects`   | `stride_list_projects`    |
| `stride.get_project`     | `stride_get_project`      |
| `stride.get_task`        | `stride_get_task`         |
| `stride.list_areas`      | `stride_list_areas`       |
| `stride.add_task`        | `stride_add_task`         |
| `stride.update_task`     | `stride_update_task`      |
| `stride.complete_task`   | `stride_complete_task`    |
| `stride.delete_task`     | `stride_delete_task`      |
| `stride.restore_task`    | `stride_restore_task`     |
| `stride.add_project`     | `stride_add_project`      |
| `stride.update_project`  | `stride_update_project`   |
| `stride.delete_project`  | `stride_delete_project`   |
| `stride.add_area`        | `stride_add_area`         |
| `stride.update_area`     | `stride_update_area`      |
| `stride.delete_area`     | `stride_delete_area`      |

**Upgrade action:** find and replace `stride.` with `stride_` in any MCP client configs, system prompts, scripts, or automations that reference these tool names. No other changes are required.

---

## Tools

- `stride_list_tasks`
  - Input: `{ status?, projectId?, includeDeleted?, limit?, offset?, search?, dueDateFrom?, dueDateTo?, isFocusedToday?, view?, sortBy?, sortOrder? }`
  - `view` narrows by GTD availability: `available`, `deferred` or `blocked`
- `stride_list_projects`
  - Input: `{}`
- `stride_get_project`
  - Input: `{ id, includeDeleted? }`
- `stride_list_view_sections` — view section IDs, titles and order; optional `view`: `someday`, `waiting`, or `focus` (SQLite/Cloud)
- `stride_list_sections`
  - Input: `{ projectId?, includeDeleted? }`
- `stride_get_section`
  - Input: `{ id, includeDeleted? }`
- `stride_list_areas`
  - Input: `{}`
- `stride_list_people`
  - Input: `{ includeDeleted? }`
- `stride_get_person`
  - Input: `{ id, includeDeleted? }`
- `stride_get_task`
  - Input: `{ id, includeDeleted? }`
- `stride_add_task` **(requires `--write`)**
  - Input: `{ title? | quickAdd?, status?, projectId?, sectionId?, viewSectionIds?, areaId?, dueDate?, startTime?, cancelledAt?, reviewAt?, recurrence?, contexts?, tags?, description?, priority?, energyLevel?, assignedTo?, timeEstimate?, taskMode?, relativeStartOffset?, showFutureRecurrence?, pushCount?, checklist?, textDirection?, location?, isFocusedToday?, timeSpentMinutes?, suppressStrideReminders?, reminderPolicy?, repeatReminderMinutes?, dueReminderLeadMinutes?, startReminderLeadMinutes?, attachments? }`
- `stride_update_task` **(requires `--write`)**
  - Input: `{ id, title?, status?, projectId?, sectionId?, viewSectionIds?, areaId?, dueDate?, startTime?, cancelledAt?, reviewAt?, recurrence?, contexts?, tags?, description?, priority?, energyLevel?, assignedTo?, timeEstimate?, taskMode?, relativeStartOffset?, showFutureRecurrence?, pushCount?, checklist?, textDirection?, location?, isFocusedToday?, timeSpentMinutes?, suppressStrideReminders?, reminderPolicy?, repeatReminderMinutes?, dueReminderLeadMinutes?, startReminderLeadMinutes?, order?, boardOrder?, focusOrder?, attachments? }`
  - `startReminderLeadMinutes`: `0` (Off), `5`, `15`, `30`, or `60` minutes before an explicit start time. Omitted legacy values remain off; date-only starts do not schedule an alert.
  - `reminderPolicy` accepts `inherit`, `send`, or `skip` for start/due reminders. Use `inherit` to follow the library default; `null` is not accepted. Existing tasks retain their legacy reminder choice until explicitly changed.
  - `recurrence` accepts a recurrence object or an RFC 5545 RRULE string. Pass `null` to clear it.
  - `attachments` holds link attachments only (`{ id?, title?, uri }`, e.g. `obsidian://`, `file://` or `https://`). The list you pass is the complete set of links: links you leave out are removed, file attachments are never touched, and `null` clears every link.
  - `cancelledAt` is an ISO timestamp with timezone. Setting it closes the task as cancelled (`archived`) without counting it as completed or generating its next recurrence. Moving it to an active status or completing it clears cancellation. Update every syncing client before using cancellation; older writers can discard the marker.
- `stride_complete_task` **(requires `--write`)**
  - Input: `{ id }`
- `stride_delete_task` **(requires `--write`)**
  - Input: `{ id }`
- `stride_restore_task` **(requires `--write`)**
  - Input: `{ id }`
- `stride_add_project` **(requires `--write`)**
  - Input: `{ title, color?, status?, areaId?, isSequential?, isFocused?, viewSectionIds?, dueDate?, startDate?, cancelledAt?, reviewAt?, supportNotes?, attachments? }`
- `stride_update_project` **(requires `--write`)**
  - Input: `{ id, title?, color?, status?, areaId?, isSequential?, isFocused?, viewSectionIds?, dueDate?, startDate?, cancelledAt?, reviewAt?, supportNotes?, attachments? }`
  - `attachments` follows the same rule as `stride_update_task`: link attachments only, the list is the complete set of links, and `null` clears them.
- `stride_delete_project` **(requires `--write`)**
  - Input: `{ id }`
- `stride_add_section` **(requires `--write`)**
  - Input: `{ projectId, title, description?, order?, isCollapsed? }`
- `stride_update_section` **(requires `--write`)**
  - Input: `{ id, title?, description?, order?, isCollapsed? }`
- `stride_delete_section` **(requires `--write`)**
  - Input: `{ id }`
- `stride_add_area` **(requires `--write`)**
  - Input: `{ name, color?, icon? }`
- `stride_update_area` **(requires `--write`)**
  - Input: `{ id, name?, color?, icon? }`
- `stride_delete_area` **(requires `--write`)**
  - Input: `{ id }`
- `stride_add_person` **(requires `--write`)**
  - Input: `{ name, note?, referenceLink? }`
- `stride_update_person` **(requires `--write`)**
  - Input: `{ id, name?, note?, referenceLink? }`
- `stride_rename_person` **(requires `--write`)**
  - Input: `{ id, name, updateTasks? }`
- `stride_delete_person` **(requires `--write`)**
  - Input: `{ id }`

All tools return JSON text payloads with the resulting task, project, section, area, person, or collection payload.

---

## Testing

### Quick smoke test (CLI)

1) Start the server (read‑only):
```bash
bun run stride:mcp -- --db "~/.local/share/stride/stride.db"
```

2) Connect via your MCP client and run:
- `stride_list_tasks` (limit 5)

If you want to test writes, restart with `--write`:
```bash
bun run stride:mcp -- --db "~/.local/share/stride/stride.db" --write
```

Then test:
- `stride_add_task` (quickAdd: "Test task @home /due:tomorrow")
- `stride_complete_task` (use returned task id)
- `stride_update_task` (e.g. set status or dueDate)
- `stride_delete_task` (use returned task id)
- `stride_get_task` (use returned task id)
- `stride_restore_task` (after delete, restore the task)
- `stride_list_projects`
- `stride_get_project` (use returned project id)
- `stride_list_areas`
- `stride_list_people`
- `stride_add_project`
- `stride_update_project`
- `stride_delete_project`
- `stride_add_area`
- `stride_update_area`
- `stride_delete_area`
- `stride_add_person`
- `stride_update_person`
- `stride_rename_person`
- `stride_get_person` (use returned person id)
- `stride_delete_person`
- `stride_list_tasks` with `dueDateFrom`, `dueDateTo`, `sortBy`, `sortOrder`

If the list returns tasks and add/complete works, the server is healthy.

### Stdio JSON-RPC E2E (transport validation)

Use any MCP client or a small script to send:
- `initialize`
- `notifications/initialized`
- `tools/list`
- `tools/call` (e.g. `stride_list_projects` or `stride_list_tasks`)

If these succeed, the stdio transport is working end-to-end.

### Claude Code sanity check

1) Add the server:
```bash
claude mcp add stride -- \
  bun /path/to/Stride/apps/mcp-server/src/cli.ts --db "/path/to/stride.db" --write
```
2) Restart Claude Code, run `/mcp`, and verify **stride** is connected.
3) Ask the model to call:
   - `stride_list_tasks` (limit 5)
   - `stride_add_task` (quickAdd: "Test MCP @home /due:tomorrow")
   - `stride_complete_task` (use returned id)

---

## Safety & Concurrency

The SQLite details below apply to direct database mode. Local API mode uses the desktop app's native handlers, and Cloud mode uses the self-hosted server.

- The server uses **SQLite WAL mode**. Read-only tools can run while the desktop app is open.
- Write tools fail fast on SQLite writer locks, then retry the whole Stride write operation. Each retry reloads current data before applying the requested change, so a delayed MCP write does not keep working from a stale pre-lock snapshot.
- Writes are **disabled by default**. Use `--write` to enable edits.
- Write operations go through the shared **@stride/core** store to enforce business rules (both Bun and Node).
- SQL is reserved for read-heavy paths (list/search) where performance matters.
- Do not point a separate container/server deployment at the same local storage or sync data while the desktop app is also writing. That creates independent writers outside the local SQLite coordination path and is unsupported.

---

## Notes

- This MCP server targets the SQLite database used by the desktop app, with mutations routed through `@stride/core`.
- Keep an eye on schema changes across app versions (update queries if needed).

### View section assignments

In SQLite and Cloud mode, call `stride_list_view_sections` (optionally with
`{"view":"someday"}`) to resolve section IDs and titles. The result is
`{"viewSections":[{"view":"someday","id":"books","title":"Books","order":0}]}`.
These are view headings, separate from project sections returned by
`stride_list_sections`. Create or rename view headings in the Stride app.

Task and project create/update tools accept `viewSectionIds`, for example
`{"someday":"books","waiting":"people"}`. Assigning a heading does not change
the entity's status. Updates replace the **whole map**: include other view
assignments you want to retain. Omit the field to preserve assignments; pass
`{}` or, on update, `null` to clear all assignments. To clear one view, send the
map containing only the other assignments. Values must be nonempty section-ID
strings; unknown view names remain supported for compatibility with newer apps.

The catalogue works in read-only mode. Assignment writes require `--write`.
Cloud mode uses the existing data endpoint and works with Stride Cloud 1.3.7.
Desktop Local API mode supports task assignments by known ID, but does not expose
the view section catalogue or project assignments; unsupported inputs are rejected.
