# AI Chatbox

ChatGPT-style web UI backed by `opencode run`. The app runs as one Next.js container and uses a ChatGPT Plus/Pro OAuth credential stored in a private Docker volume.

## Architecture

```text
Browser
  -> Next.js Web UI
  -> /api/upload stores files in /data/workspaces/<session>/uploads
  -> text-based PDFs are converted to bounded UTF-8 sidecars with pdftotext
  -> /api/chat runs opencode run --dir /data/workspaces/<session>
  -> generated files are saved in /data/workspaces/<session>/outputs
  -> opencode reads and refreshes OpenAI OAuth in the opencode-auth volume
```

Chat responses stream back to the browser while `opencode run` is still working. Generated files are listed after the run completes.

PDF uploads keep the original file and create an internal `.pdf.txt` sidecar for model input. Extraction has a 60-second timeout and a 1 MB text limit. The UI warns when text is truncated, extraction fails, or the PDF has no text layer. Image-only scanned PDFs require OCR before upload.

Sessions are stored on disk under `WORKSPACE_ROOT`. Each session keeps `metadata.json`, `messages.json`, `uploads/`, and `outputs/`, and the sidebar can switch between previous chats.
Use the `×` button in the chat history list to delete a session and its workspace files.

## Mac Local Test

Docker uses OpenCode's official headless ChatGPT Plus/Pro OAuth flow. ChatGPT Plus does not provide a normal OpenAI API key; the OAuth access and refresh tokens are created by `opencode auth login` and persisted in the `opencode-auth` Docker volume.

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
OPENCODE_PROVIDER=openai
OPENCODE_MODEL=openai/gpt-5.4
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

Start the container, then complete the one-time ChatGPT device login:

```bash
docker compose up --build -d
docker compose exec app opencode auth login --provider openai --method "ChatGPT Pro/Plus (headless)"
```

Open the URL printed by the command, enter its device code, and sign in with the ChatGPT Plus account. Verify the persistent credential and available subscription models:

```bash
docker compose exec app opencode auth list
docker compose exec app opencode models openai --refresh
docker compose exec app opencode run --model openai/gpt-5.4 "用繁體中文回答：ChatGPT OAuth 可以正常使用嗎？"
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

The default is `openai/gpt-5.4`. The dropdown is populated from the OpenAI models that OpenCode allows for ChatGPT Plus/Pro OAuth; the exact list can change with the subscription and OpenCode version.

| Task | Recommended models |
| --- | --- |
| General chat, summaries, Office documents, and research | `openai/gpt-5.4` |
| Faster and lighter repetitive work | `openai/gpt-5.4-mini` |
| Repository edits, scripts, and complex Excel automation | `openai/gpt-5.3-codex-spark` |
| Difficult reasoning and review | `openai/gpt-5.5` when shown by `opencode models openai` |

Office file creation is performed by OpenCode tools plus the Python libraries in the image, not by a special Office model. Text-based PDFs use the server-extracted sidecar. Image analysis requires a model with image input. ChatGPT's web image-generation feature is not automatically exposed through OpenCode OAuth, so image output still needs a separate image-generation tool or API.

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
OPENCODE_PROVIDER=openai
OPENCODE_MODEL=openai/gpt-5.4
OPENCODE_MODEL_OPTIONS=
OPENCODE_TIMEOUT_MS=600000
ADMIN_USERNAME=home
ADMIN_PASSWORD=<new password with at least 8 characters>
APP_SECRET=<random secret>
CLOUDFLARE_TUNNEL_TOKEN=<tunnel token>
```

The EC2 host does not need opencode installed. The Docker image installs a pinned version, and the `opencode-auth` named volume keeps the OAuth refresh token across container rebuilds.

The app port is bound to `127.0.0.1` only. Do not open EC2 inbound port 3000 for production use.

Start locally on the EC2 host:

```bash
docker compose up --build -d
docker compose exec app opencode auth login --provider openai --method "ChatGPT Pro/Plus (headless)"
docker compose exec app opencode auth list
docker compose exec app opencode models openai --refresh
docker compose exec app opencode run --model openai/gpt-5.4 "用繁體中文回覆 hello"
```

The login command prints `https://auth.openai.com/codex/device` and a one-time code. Open that URL on your own computer, enter the code, and authenticate with the ChatGPT Plus account. Do not use a personal subscription as a shared public API for unrelated users.

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

### Migrate an Existing OpenCode Go Deployment

Pull the new image configuration and change only these lines in the existing private `.env`:

```env
OPENCODE_PROVIDER=openai
OPENCODE_MODEL=openai/gpt-5.4
OPENCODE_MODEL_OPTIONS=
OPENCODE_API_KEY=
```

Recreate the app, complete OAuth, verify it, and restart the app once:

```bash
git pull
docker compose --profile tunnel up --build --force-recreate -d
docker compose exec app opencode auth login --provider openai --method "ChatGPT Pro/Plus (headless)"
docker compose exec app opencode auth list
docker compose exec app opencode run --model openai/gpt-5.4 "用繁體中文回覆：OAuth 已完成"
docker compose --profile tunnel restart app
docker compose logs -f app cloudflared
```

Normal `docker compose down` keeps the OAuth and workspace volumes. Do not run `docker compose down -v` unless you intentionally want to delete both the saved ChatGPT login and all chat workspaces.

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `WORKSPACE_ROOT` | Container path for uploaded files and session workspaces. Keep `/data/workspaces` for Docker. |
| `OPENCODE_BIN` | opencode executable path. Usually `opencode`. |
| `OPENCODE_PROVIDER` | Provider used to discover dropdown models. Use `openai` for ChatGPT Plus/Pro OAuth. |
| `OPENCODE_API_KEY` | Optional OpenCode Go rollback key. Leave blank for ChatGPT OAuth. |
| `OPENCODE_MODEL` | Server-side default model. Use `openai/gpt-5.4` for ChatGPT OAuth. |
| `OPENCODE_MODEL_OPTIONS` | Optional comma-separated dropdown override. Leave blank to discover OAuth-compatible OpenAI models through the CLI. |
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
- ChatGPT OAuth gives OpenCode model access but does not reproduce every feature of the ChatGPT website, such as its image-generation UI or custom GPTs.
- The built-in login is a single shared account, not a multi-user identity system.

## Troubleshooting

If the browser shows `opencode failed.`, check the real error with:

```bash
docker compose logs -f
```

Verify that OpenCode detects the persistent OAuth credential:

```bash
docker compose exec app opencode auth list
```

The output should list `OpenAI oauth`. If it is missing, repeat the headless login command. To disconnect the subscription, run `docker compose exec app opencode auth logout openai`.

If the browser shows `opencode timed out`, first test the same command inside the running container:

```bash
docker compose exec app opencode run --model openai/gpt-5.4 "用繁體中文回覆 hello"
```

The app starts opencode without an interactive stdin, so browser requests should not wait for terminal input.
