# AI Chatbox

ChatGPT-style web UI backed by `opencode run`. The app runs as one Next.js container and uses your existing OpenCode Zen credential from `~/.local/share/opencode/auth.json`.

## Architecture

```text
Browser
  -> Next.js Web UI
  -> /api/upload stores files in /data/workspaces/<session>/uploads
  -> /api/chat runs opencode run --dir /data/workspaces/<session>
  -> opencode reads mounted auth.json from ~/.local/share/opencode
```

The first version is non-streaming: the browser waits until `opencode run` completes, then shows the result.

## Mac Local Test

Install and login to opencode on your Mac first:

```bash
brew install anomalyco/tap/opencode
opencode auth login
opencode auth list
opencode run "用繁體中文回答：opencode 可以正常使用嗎？"
```

Clone and configure this app:

```bash
git clone https://github.com/nichodelightful/opencode_frontend.git
cd opencode_frontend
cp .env.example .env
```

Edit `.env` and set your Mac opencode credential directory:

```env
WORKSPACE_ROOT=/data/workspaces
OPENCODE_BIN=opencode
OPENCODE_AUTH_DIR=/Users/YOUR_NAME/.local/share/opencode
OPENCODE_MODEL=
OPENCODE_TIMEOUT_MS=180000
APP_SECRET=change-me
```

You can get the correct path with:

```bash
echo "$HOME/.local/share/opencode"
```

Run with Docker:

```bash
docker compose up --build
```

Open:

```text
http://localhost:3000
```

Stop with `Ctrl+C`, or run in background:

```bash
docker compose up --build -d
docker compose logs -f
docker compose down
```

## EC2 Deployment

Recommended instance for initial testing:

```text
Ubuntu 24.04 LTS
t3.medium or t3.large
30GB+ disk
```

Install Docker and Compose plugin:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Log out and back in, then verify:

```bash
docker --version
docker compose version
```

Install and login to opencode on EC2:

```bash
curl -fsSL https://opencode.ai/install | bash
opencode auth login
opencode auth list
opencode run "用繁體中文回答：EC2 的 opencode 可以正常使用嗎？"
```

Deploy the app:

```bash
git clone https://github.com/nichodelightful/opencode_frontend.git
cd opencode_frontend
cp .env.example .env
nano .env
```

EC2 `.env` example:

```env
WORKSPACE_ROOT=/data/workspaces
OPENCODE_BIN=opencode
OPENCODE_AUTH_DIR=/home/ubuntu/.local/share/opencode
OPENCODE_MODEL=
OPENCODE_TIMEOUT_MS=180000
APP_SECRET=change-me
```

Start:

```bash
docker compose up --build -d
docker compose logs -f
```

Open for temporary testing if your security group allows port 3000:

```text
http://EC2_PUBLIC_IP:3000
```

For real family usage, put Cloudflare Tunnel and Cloudflare Access in front instead of exposing port 3000.

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `WORKSPACE_ROOT` | Container path for uploaded files and session workspaces. Keep `/data/workspaces` for Docker. |
| `OPENCODE_BIN` | opencode executable path. Usually `opencode`. |
| `OPENCODE_AUTH_DIR` | Host path containing `auth.json`, mounted into the container. |
| `OPENCODE_MODEL` | Optional model override. Leave blank to use opencode default. |
| `OPENCODE_TIMEOUT_MS` | Maximum time for one `opencode run` request. Default is 180000. |
| `APP_SECRET` | Reserved for future app auth/session features. |

## Files

- `src/app/page.tsx`: chat UI and drag-and-drop upload.
- `src/app/api/upload/route.ts`: stores uploaded files.
- `src/app/api/chat/route.ts`: calls `opencode run`.
- `src/lib/workspace.ts`: session workspace helpers.
- `Dockerfile`: builds Next.js and installs opencode.
- `docker-compose.yml`: mounts workspace and opencode auth directory.

## Known Limitations

- Responses are not streamed yet.
- Only basic workspace isolation is implemented.
- Output file download UI is not implemented yet.
- Cloudflare Access identity is not wired into per-user directories yet.

## Troubleshooting

If the browser shows `opencode failed.`, check the real error with:

```bash
docker compose logs -f
```

Also verify the mounted credential directory:

```bash
echo "$HOME/.local/share/opencode"
ls "$HOME/.local/share/opencode/auth.json"
```

Your `.env` must point `OPENCODE_AUTH_DIR` to that host directory, not to `/data/workspaces`.

If the browser shows `opencode timed out`, first test the same command inside the running container:

```bash
docker compose exec app opencode run "用繁體中文回覆 hello"
```

The app starts opencode without an interactive stdin, so browser requests should not wait for terminal input.
