# Stride Docker (PWA + Cloud)

This folder contains Dockerfiles and a compose file to run:
- **stride-cloud**: the lightweight sync server + REST API. The only service the native desktop and mobile apps need.
- **stride-app**: optional; the web/PWA build of the app, served by Nginx, for using Stride in a browser.

If you only sync native desktop/mobile clients, run just `stride-cloud` (the HTTPS compose file below does exactly that) and expose a single domain. `stride-app` is a second, independent web service - behind a reverse proxy it needs its own origin, which is why running both means two domains.

## Quick start (HTTP compose)

You do not need to clone the repository. Download the Compose file into an empty directory:

```bash
curl -LO https://raw.githubusercontent.com/ishaanpilar/stride/main/docker/compose.yaml
```

Create a `.env` file next to it (Compose reads this automatically):

```dotenv
STRIDE_CLOUD_AUTH_TOKENS=replace_with_a_token_at_least_20_characters_long
STRIDE_CLOUD_CORS_ORIGIN=http://localhost:5173
```

`STRIDE_CLOUD_CORS_ORIGIN` must be the exact address you open the PWA at in your browser, including scheme and port. `http://localhost:5173` only works when the browser runs on the Docker host itself. From any other machine, use the host's address, for example `http://192.168.1.20:5173`. Only one origin can be set.

Then pull and start the published images:

```bash
docker compose pull
docker compose up -d
```

Then open:
- PWA: `http://localhost:5173`
- Cloud liveness: `http://localhost:8787/health`
- Cloud storage readiness: `http://localhost:8787/ready`
- Self-Hosted URL for local testing: `http://localhost:8787`
- REST API base URL: `http://localhost:8787/v1`

From a phone or another computer, replace `localhost` with the Docker host's LAN IP. In Stride, use the cloud port (`http://HOST_IP:8787`) as the Self-Hosted URL, not the PWA port (`:5173`).

From v1.3.8, the Docker web app permits HTTP connections to the same hostname or IPv4 address on another port. Use the same address for the PWA and Cloud URLs, and set `STRIDE_CLOUD_CORS_ORIGIN` to the PWA origin. Another LAN HTTP host is still blocked by the browser policy, even with Allow insecure connections enabled; use HTTPS for a separate cloud host.

To build from source instead, clone the repository and run `docker compose -f docker/compose.yaml up --build -d` from its root.

This HTTP compose file is best for local testing. Stride desktop and mobile clients accept HTTP for localhost, private IPs, and local hostnames. Public URLs should use HTTPS.

`/health` reports only whether the Cloud process can answer HTTP requests. `/ready`
also verifies that the configured data directory is currently safe and writable.
The image supplies its own Docker health check: current images use `/ready`,
while older images use `/health`. Compose uses the check built into the image.

## Dropbox sync and the Docker PWA

The `stride-app` Docker image serves the browser/PWA build. Native Dropbox OAuth sync is not available in this runtime because Dropbox connection is implemented by the native desktop and mobile apps. Supplying `VITE_DROPBOX_APP_KEY` or `DROPBOX_APP_KEY` through `.env`, `env_file`, or compose runtime environment will not enable Dropbox in Docker.

For Docker-hosted sync, use the bundled self-hosted cloud server or WebDAV. If the self-hosted endpoint is behind Authelia or another interactive SSO proxy, configure the proxy to let the Stride sync/API path use Stride's bearer token directly; the mobile app cannot complete an Authelia browser login in front of `/v1/data`.

## HTTPS quick start (Cloud + Caddy)

Use the HTTPS compose file when syncing real desktop or mobile clients to a self-hosted cloud server:

```bash
cp docker/.env.https.example docker/.env.https.local
```

Edit `docker/.env.https.local`:

```dotenv
STRIDE_CLOUD_DOMAIN=stride.example.com
STRIDE_CLOUD_AUTH_TOKENS=your_long_random_token
STRIDE_CLOUD_CORS_ORIGIN=https://stride.example.com
STRIDE_CADDYFILE=Caddyfile.https
```

Start the HTTPS stack:

```bash
docker compose --env-file docker/.env.https.local -f docker/compose.https.yaml up -d
```

Then check:

```bash
curl https://stride.example.com/ready
```

In Stride Settings -> Sync -> Self-Hosted, use:

```text
https://stride.example.com
```

Stride will automatically append `/v1/data`.

### LAN-only HTTPS

For a hostname that only resolves on your home network, change:

```dotenv
STRIDE_CLOUD_DOMAIN=stride.home.arpa
STRIDE_CLOUD_CORS_ORIGIN=https://stride.home.arpa
STRIDE_CADDYFILE=Caddyfile.local-https
```

This uses Caddy's internal certificate authority. Each client device must trust Caddy's local root certificate before Stride will accept the HTTPS connection. Public Let's Encrypt certificates are the more reliable option for mobile clients.

After the LAN-only stack starts, you can export Caddy's local root certificate with:

```bash
docker compose --env-file docker/.env.https.local -f docker/compose.https.yaml cp caddy:/data/caddy/pki/authorities/local/root.crt ./stride-caddy-root.crt
```

Install that certificate as a trusted root on each device that will sync to this hostname.

## Configure sync token

The cloud server expects a token. In `docker/compose.yaml`, set:

```
STRIDE_CLOUD_AUTH_TOKENS=your_token_here
```

Multiple tokens are supported, comma-separated:

```
STRIDE_CLOUD_AUTH_TOKENS=alices-long-random-token,bobs-long-random-token
```

Each distinct token gets its own private dataset on the server, so several people can share one instance without seeing each other's data. Devices that should sync together must use the same token. Tokens are 20-512 characters.

`STRIDE_CLOUD_TOKEN` is still accepted for backward compatibility, but deprecated.

## Online-only web deployments

For HTTP Basic Auth deployments, set `STRIDE_PWA_ENABLED=false` on
`stride-app` (or in `.env` with the bundled Compose). This serves an online-only
replacement at `/sw.js`; leave that exact path outside proxy authentication and
route it to the app. Existing workers can then update without credentials.
The replacement does not reload tabs or delete local tasks/settings, but offline
app-shell loading is unavailable. If an old worker still blocks login, unregister
only Stride's worker in browser developer tools, close its tabs/PWA windows, and
reopen. Do not clear site data. Keep `/v1/*` on bearer authentication. Proxy login
controls server access, not access to previously downloaded browser data.
See the [deployment guide](https://github.com/ishaanpilar/stride/tree/main/docs)
for the Caddy configuration. Default `true` retains normal PWA behavior.

## Preseed the web app's sync settings

A fresh browser opening the PWA can have the Cloud URL filled in already, so people only enter their token:

- **Same domain (recommended):** when the app and the cloud API are served from one domain (the HTTPS compose does this), the app detects the cloud on its own origin automatically. Nothing to configure.
- **Split domains:** set `STRIDE_DEFAULT_CLOUD_URL` on the `stride-app` container (see the commented block in `docker/compose.yaml`) to the public cloud URL. Useful for Kubernetes or any deployment where the app and API live on different hosts.

The value only prefills the setup form. It never overwrites a URL a browser has already configured, and sync stays off until the person saves with their token.

For a file-backed Docker secret, remove `STRIDE_CLOUD_AUTH_TOKENS` from the
Compose environment file, put the token in a host file readable only by its
owner, and start Compose with the secret overlay.
`STRIDE_CLOUD_AUTH_TOKENS_FILE_HOST` must be an absolute host path:

```bash
printf '%s\n' 'replace_with_a_token_at_least_20_characters_long' > /absolute/path/stride-cloud-tokens
chmod 600 /absolute/path/stride-cloud-tokens
STRIDE_CLOUD_AUTH_TOKENS_FILE_HOST=/absolute/path/stride-cloud-tokens \
  docker compose -f docker/compose.yaml -f docker/compose.secrets.yaml up -d
```

The overlay mounts that file read-only at
`/run/secrets/stride_cloud_tokens`; the token bytes are not copied into the
rendered Compose environment. Keep the host file at mode `0600`, even when its
owner has a different UID from the container. The entrypoint makes a private
mode-`0400` copy owned by the container's `bun` user, then immediately starts
Cloud as UID/GID 1000. The server still refuses to start if neither the inline
setting nor a readable token file provides a valid token.

The same overlay works with the HTTPS stack. Remove the inline token from
`docker/.env.https.local`, then run:

```bash
STRIDE_CLOUD_AUTH_TOKENS_FILE_HOST=/absolute/path/stride-cloud-tokens \
  docker compose --env-file docker/.env.https.local \
    -f docker/compose.https.yaml -f docker/compose.secrets.yaml up -d
```

Use the **same token** in Stride Settings → Sync → Self-Hosted.
Set the Self-Hosted URL to the **base** endpoint, for example:

```
http://localhost:8787
```

Stride will automatically append `/v1/data` and store `data.json` (and attachments) under that endpoint.

Example to generate a token:

```
cat /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | fold -w 50 | head -n 1
```

Or you can use https://it-tools.tech/token-generator

## API (task automation)

The cloud container now exposes the REST API on the same host/port as sync, using the **same Bearer token**.

Base URL:

```
http://localhost:8787/v1
```

Create a task:

```
curl -X POST \
  -H "Authorization: Bearer your_token_here" \
  -H "Content-Type: application/json" \
  -d '{"input":"Review invoice from Paperless /due:tomorrow #finance"}' \
  http://localhost:8787/v1/tasks
```

List tasks:

```
curl -H "Authorization: Bearer your_token_here" \
  "http://localhost:8787/v1/tasks?status=next"
```

## Volumes

Persist cloud data by mounting a host path:

```
./data:/app/cloud_data
```

If you switch to a custom host path, make sure it is writable by the container user (uid 1000):

```
sudo chown -R 1000:1000 /path/data_dir
```

## Build without compose (optional)

```bash
# PWA
docker build -f docker/app/Dockerfile -t stride-app .

# Cloud
docker build -f docker/cloud/Dockerfile -t stride-cloud .
```

## Notes

- The PWA uses client-side rendering; Nginx is configured with `try_files` to avoid 404s on refresh.
- Bun is pinned to `1.3.5` and the build uses C++20 flags for `better-sqlite3`.
