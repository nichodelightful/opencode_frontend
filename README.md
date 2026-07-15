# AI Chatbox

ChatGPT-style web UI backed by `opencode run`. The app runs as one Next.js container and uses an OpenCode Go `auth.json` mounted into the container.

## Architecture

```text
Browser
  -> Next.js Web UI
  -> /api/upload stores files in /data/workspaces/<session>/uploads
  -> /api/chat runs opencode run --dir /data/workspaces/<session>
  -> generated files are saved in /data/workspaces/<session>/outputs
  -> opencode reads mounted auth.json from secrets/opencode/auth.json
```

Chat responses stream back to the browser while `opencode run` is still working. Generated files are listed after the run completes.

Sessions are stored on disk under `WORKSPACE_ROOT`. Each session keeps `metadata.json`, `messages.json`, `uploads/`, and `outputs/`, and the sidebar can switch between previous chats.

## Mac Local Test

You can either use your existing local opencode login, or use the example `auth.json` flow below. For this app, Docker only needs a valid `auth.json` mounted into the container.

Optional local opencode check:

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
cp secrets/opencode/auth.example.json secrets/opencode/auth.json
```

Edit `secrets/opencode/auth.json` and replace `sk-XXXXXX` with your real OpenCode Go API key:

```json
{
  "opencode-go": {
    "type": "api",
    "key": "sk-XXXXXX"
  }
}
```

Edit `.env`:

```env
WORKSPACE_ROOT=/data/workspaces
OPENCODE_BIN=opencode
OPENCODE_AUTH_DIR=./secrets/opencode
OPENCODE_MODEL=opencode-go/deepseek-v4-flash
OPENCODE_MODEL_OPTIONS=
OPENCODE_TIMEOUT_MS=600000
APP_SECRET=change-me
```

Run with Docker:

```bash
docker compose up --build
```

Open:

```text
http://localhost:3000
```

To create downloadable Office outputs, upload a `.docx`, `.xlsx`, or `.pptx` file and ask for a modified file, for example:

```text
請幫我把這份投影片改成給主管看的版本，並產生新的 pptx 檔讓我下載。
```

Generated files appear in the left sidebar under `產出檔案`.

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

Deploy the app:

```bash
git clone https://github.com/nichodelightful/opencode_frontend.git
cd opencode_frontend
cp .env.example .env
cp secrets/opencode/auth.example.json secrets/opencode/auth.json
nano secrets/opencode/auth.json
nano .env
```

EC2 `.env` example:

```env
WORKSPACE_ROOT=/data/workspaces
OPENCODE_BIN=opencode
OPENCODE_AUTH_DIR=./secrets/opencode
OPENCODE_MODEL=opencode-go/deepseek-v4-flash
OPENCODE_MODEL_OPTIONS=
OPENCODE_TIMEOUT_MS=600000
APP_SECRET=change-me
```

The EC2 host does not need opencode installed. The Docker image installs opencode; it only needs `secrets/opencode/auth.json`.

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
| `OPENCODE_AUTH_DIR` | Host path containing `auth.json`, mounted into the container. Defaults to `./secrets/opencode`. |
| `OPENCODE_MODEL` | Optional server-side default model. Use `opencode-go/<model-id>` for OpenCode Go. |
| `OPENCODE_MODEL_OPTIONS` | Optional comma-separated model list override. Leave blank to use the built-in OpenCode Go list. |
| `OPENCODE_TIMEOUT_MS` | Maximum time for one `opencode run` request. Default is 600000. |
| `APP_SECRET` | Reserved for future app auth/session features. |

## Files

- `src/app/page.tsx`: chat UI and drag-and-drop upload.
- `src/app/api/upload/route.ts`: stores uploaded files.
- `src/app/api/chat/route.ts`: calls `opencode run`.
- `src/app/api/outputs/route.ts`: lists generated downloadable files.
- `src/app/api/download/route.ts`: downloads files from the session `outputs/` directory.
- `src/app/api/sessions/route.ts`: lists and creates chat sessions.
- `src/app/api/sessions/[sessionId]/route.ts`: loads one chat session with messages and outputs.
- `src/lib/workspace.ts`: session workspace helpers.
- `Dockerfile`: builds Next.js and installs opencode.
- `docker-compose.yml`: mounts workspace and opencode auth directory.

## Known Limitations

- Streaming is line-oriented from the `opencode run` process, so some output may still be finalized or cleaned up at the end of the request.
- Only basic workspace isolation is implemented.
- Chat files and outputs remain in the same session workspace, but full conversation history is not replayed into each model call yet.
- Complex Office formatting, animations, comments, and tracked changes may not be preserved perfectly.
- Cloudflare Access identity is not wired into per-user directories yet.

## Troubleshooting

If the browser shows `opencode failed.`, check the real error with:

```bash
docker compose logs -f
```

Also verify the mounted credential directory:

```bash
ls secrets/opencode/auth.json
```

Your `.env` must point `OPENCODE_AUTH_DIR` to that host directory, not to `/data/workspaces`.

If the browser shows `opencode timed out`, first test the same command inside the running container:

```bash
docker compose exec app opencode run "用繁體中文回覆 hello"
```

The app starts opencode without an interactive stdin, so browser requests should not wait for terminal input.
