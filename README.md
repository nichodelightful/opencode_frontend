# AI Chatbox

ChatGPT-style web UI backed by `opencode run`. The app runs as one Next.js container and receives the OpenCode Go API key through its private `.env` file.

## Architecture

```text
Browser
  -> Next.js Web UI
  -> /api/upload stores files in /data/workspaces/<session>/uploads
  -> text-based PDFs are converted to bounded UTF-8 sidecars with pdftotext
  -> /api/chat runs opencode run --dir /data/workspaces/<session>
  -> generated files are saved in /data/workspaces/<session>/outputs
  -> opencode reads OPENCODE_API_KEY from the container environment
```

Chat responses stream back to the browser while `opencode run` is still working. Generated files are listed after the run completes.

PDF uploads keep the original file and create an internal `.pdf.txt` sidecar for model input. Extraction has a 60-second timeout and a 1 MB text limit. The UI warns when text is truncated, extraction fails, or the PDF has no text layer. Image-only scanned PDFs require OCR before upload.

Sessions are stored on disk under `WORKSPACE_ROOT`. Each session keeps `metadata.json`, `messages.json`, `uploads/`, and `outputs/`, and the sidebar can switch between previous chats.
Use the `×` button in the chat history list to delete a session and its workspace files.

## Mac Local Test

Docker needs a valid OpenCode Go API key in `.env`.

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
```

Edit `.env`:

```env
WORKSPACE_ROOT=/data/workspaces
OPENCODE_BIN=opencode
OPENCODE_API_KEY=<OpenCode Go API key>
OPENCODE_MODEL=opencode-go/gpt-5.6-luna
OPENCODE_MODEL_OPTIONS=
OPENCODE_TIMEOUT_MS=600000
ADMIN_USERNAME=home
ADMIN_PASSWORD=<new password with at least 8 characters>
APP_SECRET=<random secret>
```

Generate `APP_SECRET` and keep `.env` readable only by your account:

```bash
openssl rand -base64 48
chmod 600 .env
```

Set `ADMIN_PASSWORD` to a new password that has not been shared in messages or committed anywhere. Never commit `.env`.

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

Text-based PDFs can be uploaded directly for summarization or analysis. If the app reports that a PDF has no extractable text layer, run OCR on the document first and upload the OCR result.

## Model Selection

The default is `opencode-go/gpt-5.6-luna`, a fast international option with tool calling and native image/PDF input. The server-extracted PDF text sidecar also lets text-only models analyze text-based PDFs.

| Task | Recommended models |
| --- | --- |
| General chat, summaries, and high-volume work | `gpt-5.6-luna`, `deepseek-v4-flash`, `mimo-v2.5` |
| Long repository edits and coding agents | `glm-5.2`, `kimi-k2.7-code`, `deepseek-v4-pro` |
| Difficult reasoning and highest-quality review | `kimi-k3`, `qwen3.8-max`, `grok-4.5` |
| Office documents and business writing | `gpt-5.6-luna`, `minimax-m2.7`, `qwen3.7-plus` |
| Image or video understanding | `qwen3.8-max`, `qwen3.7-plus`, `kimi-k3`, `kimi-k2.7-code`, `mimo-v2.5` |
| Low-cost repetitive agent work | `deepseek-v4-flash`, `mimo-v2.5`, `hy3` |

The public Go models endpoint is a catalog, not a guarantee that every model is enabled for a specific workspace. A `403 RegionError` means the selected model version is currently hosted in China and the workspace has not opted in. Open the workspace URL included in the error and enable China-hosted models, or switch to an international model such as `gpt-5.6-luna` or `grok-4.5`.

Avoid deprecated compatibility IDs for new work: `minimax-m2.5`, `kimi-k2.5`, `glm-5`, `qwen3.5-plus`, `mimo-v2-pro`, and `mimo-v2-omni`. Use `OPENCODE_MODEL_OPTIONS` to restrict the dropdown to models verified for your workspace.

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
nano .env
```

EC2 `.env` example:

```env
WORKSPACE_ROOT=/data/workspaces
OPENCODE_BIN=opencode
OPENCODE_API_KEY=<OpenCode Go API key>
OPENCODE_MODEL=opencode-go/gpt-5.6-luna
OPENCODE_MODEL_OPTIONS=
OPENCODE_TIMEOUT_MS=600000
ADMIN_USERNAME=home
ADMIN_PASSWORD=<new password with at least 8 characters>
APP_SECRET=<random secret>
CLOUDFLARE_TUNNEL_TOKEN=<tunnel token>
```

The EC2 host does not need opencode installed. The Docker image installs a pinned opencode version and reads `OPENCODE_API_KEY` from `.env`.

The app port is bound to `127.0.0.1` only. Do not open EC2 inbound port 3000 for production use.

Start locally on the EC2 host:

```bash
docker compose up --build -d
docker compose logs -f
```

Verify on the EC2 host:

```text
http://127.0.0.1:3000
```

### Cloudflare Tunnel

1. In Cloudflare Zero Trust, create a named tunnel and choose Docker as the connector type.
2. Add a public hostname for your domain with service URL `http://app:3000`.
3. Copy only the tunnel token into `CLOUDFLARE_TUNNEL_TOKEN` in `.env`.
4. In Cloudflare DNS/SSL, keep the generated hostname proxied and use Full (strict) encryption mode.
5. Add a Cloudflare WAF rate limiting rule for `/api/auth/login` as an outer layer that persists across app restarts.
6. Start the app and tunnel profile:

```bash
docker compose --profile tunnel up --build -d
docker compose logs -f app cloudflared
```

The EC2 security group only needs inbound SSH from a trusted IP. Cloudflare Tunnel makes an outbound connection, so ports 80, 443, and 3000 do not need inbound rules.

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `WORKSPACE_ROOT` | Container path for uploaded files and session workspaces. Keep `/data/workspaces` for Docker. |
| `OPENCODE_BIN` | opencode executable path. Usually `opencode`. |
| `OPENCODE_API_KEY` | OpenCode Go API key passed to the container. Keep `.env` private and never commit it. |
| `OPENCODE_MODEL` | Optional server-side default model. Use `opencode-go/<model-id>` for OpenCode Go. |
| `OPENCODE_MODEL_OPTIONS` | Optional comma-separated model list override. Leave blank to detect current models from the official OpenCode Go API, with CLI and built-in fallbacks. |
| `OPENCODE_TIMEOUT_MS` | Maximum time for one `opencode run` request. Default is 600000. |
| `ADMIN_USERNAME` | Single account username for the web login. |
| `ADMIN_PASSWORD` | Single account password. Keep `.env` private and never commit it. |
| `APP_SECRET` | Random value of at least 32 characters used to sign login sessions. |
| `CLOUDFLARE_TUNNEL_TOKEN` | Token for the optional `cloudflared` Compose profile. |

Changing `ADMIN_PASSWORD` immediately invalidates existing sessions. Rotating `APP_SECRET` also invalidates every session and is recommended after any suspected credential or cookie compromise.

## Files

- `src/app/page.tsx`: chat UI and drag-and-drop upload.
- `src/app/login/page.tsx`: single-user login UI.
- `src/middleware.ts`: protects the app, files, and APIs with a signed session cookie.
- `src/app/api/upload/route.ts`: stores uploaded files.
- `src/app/api/chat/route.ts`: calls `opencode run`.
- `src/app/api/outputs/route.ts`: lists generated downloadable files.
- `src/app/api/download/route.ts`: downloads files from the session `outputs/` directory.
- `src/app/api/sessions/route.ts`: lists and creates chat sessions.
- `src/app/api/sessions/[sessionId]/route.ts`: loads one chat session with messages and outputs.
- `src/lib/workspace.ts`: session workspace helpers.
- `Dockerfile`: builds Next.js and installs opencode.
- `docker-compose.yml`: mounts the workspace and provides an optional Cloudflare Tunnel profile.

## Known Limitations

- Streaming is line-oriented from the `opencode run` process, so some output may still be finalized or cleaned up at the end of the request.
- Only basic workspace isolation is implemented.
- Chat files and outputs remain in the same session workspace, but full conversation history is not replayed into each model call yet.
- Complex Office formatting, animations, comments, and tracked changes may not be preserved perfectly.
- Image-only scanned PDFs are detected but not OCRed by the app.
- The built-in login is a single shared account, not a multi-user identity system.

## Troubleshooting

If the browser shows `opencode failed.`, check the real error with:

```bash
docker compose logs -f
```

Verify that OpenCode detects the environment credential:

```bash
docker compose exec app opencode auth list
```

The output should list `OpenCode Go` under `Environment` with `OPENCODE_API_KEY`.

If the browser shows `opencode timed out`, first test the same command inside the running container:

```bash
docker compose exec app opencode run "用繁體中文回覆 hello"
```

The app starts opencode without an interactive stdin, so browser requests should not wait for terminal input.
