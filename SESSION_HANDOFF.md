# Session Handoff

Last updated: 2026-09-22

This is a sanitized engineering handoff for the AI ChatBox deployment session. It intentionally excludes passwords, API keys, OAuth tokens, cookies, and one-time device codes.

## Resume Here

For the next session:

1. Read this file and `README.md`.
2. Run `git status --short --branch` and `git log --oneline -10`.
3. Confirm the EC2 checkout has pulled commit `c6db62d` or newer.
4. Continue from **Current EC2 Action** below.

Repository:

- GitHub: `https://github.com/nichodelightful/opencode_frontend`
- Branch: `main`
- Local working copy used in this session: `/home/ubuntu/workspace/opencode_frontend`
- EC2 working copy reported by the user: `/home/ubuntu/opencode_frontend`
- Production hostname: `https://go.agilabs.app`

## Goal

Run a private, single-account ChatGPT-style application on EC2 through Cloudflare Tunnel. The app uses `opencode run` for chat, file analysis, Office document generation, web tools, and workspace operations.

The provider was originally OpenCode Go. It has now been changed to support the user's USD 20/month ChatGPT Plus subscription through OpenCode's official OpenAI OAuth device flow.

## Completed Work

### Authentication and deployment

- Added a single-account login with signed HMAC sessions.
- Protected pages and APIs with middleware.
- Added login rate limiting, request-size checks, origin validation, and health configuration checks.
- Bound the application to `127.0.0.1:3000` on the EC2 host.
- Added an optional Cloudflare Tunnel Compose profile using service URL `http://app:3000`.
- Kept `.env` and credentials out of the Docker build context.
- Pinned Next.js to `15.5.20` and OpenCode CLI to `1.18.9`.

### OpenCode provider support

- Initially added OpenCode Go model discovery and `OPENCODE_API_KEY` support.
- Diagnosed the earlier generic warning as an OpenCode provider failure, not an app timeout.
- The concrete failure was HTTP `403 RegionError`: a selected model version was hosted in China and required explicit workspace opt-in.
- Streaming now extracts OpenCode JSON error messages and displays the real provider error instead of only saying that a tool or sub-step failed.
- App timeout remains controlled by `OPENCODE_TIMEOUT_MS`, defaulting to 600000 ms.
- Route `maxDuration` was aligned to 600 seconds.
- Fixed the timeout/child-close race so a timed-out process does not write to an already closed stream.

### PDF and Office support

- Added Poppler `pdftotext` to the production image.
- Text PDFs retain the original file and get an internal UTF-8 `.pdf.txt` sidecar.
- PDF extraction is limited to 60 seconds and 1 MB of text.
- The UI warns about truncated text, missing text layers, and parse failures.
- Internal sidecars do not appear as duplicate uploads.
- Existing session PDFs get sidecars when loaded.
- Scanned/image-only PDFs still require OCR; OCR is not implemented.
- The image contains `python-docx`, `python-pptx`, and `openpyxl` for Office output generation.

### ChatGPT Plus OAuth migration

- `OPENCODE_PROVIDER=openai` is now the default.
- `OPENCODE_MODEL=openai/gpt-5.4` is now the default.
- `OPENCODE_API_KEY` is optional, so Compose no longer blocks startup when using OAuth.
- Added the `opencode-auth` named volume at `/home/nextjs/.local/share/opencode`.
- The named volume persists OpenAI access and refresh tokens across image rebuilds and container recreation.
- Model discovery now calls `opencode models openai` and filters to models OpenCode permits for ChatGPT Plus/Pro OAuth.
- OpenCode Go remains available as a rollback by setting `OPENCODE_PROVIDER=opencode-go` and supplying `OPENCODE_API_KEY`.

## Important Commits

- `c6db62d Support ChatGPT subscription OAuth`
- `3a596b7 Report OpenCode failures clearly`
- `1028112 Extract PDF text for model input`
- `dbc2355 Load OpenCode Go key from environment`
- `874c3e2 Allow eight character login passwords`
- `09d9b65 Fix OpenCode runtime permissions`
- `78b38aa Simplify login password setup`
- `575cc7e Detect OpenCode Go models dynamically`
- `f1fe1c6 Add secure login and tunnel deployment`

All commits above were pushed to `origin/main` during this session.

## Verification Completed Locally

- Production Docker build passed after the PDF changes.
- Tested text, empty/image-only, corrupt, oversized-text, extensionless, and legacy-session PDF paths.
- Production Docker build passed after timeout/error handling changes.
- Simulated a partial response followed by a `403 RegionError`; the SSE response included the real message and opt-in URL.
- Simulated a 100 ms app timeout; it returned only the timeout error with no closed-controller exception.
- Production Docker build passed after ChatGPT OAuth support.
- Confirmed the headless OAuth command prints the OpenAI device URL and a one-time code.
- Confirmed a correctly shaped OAuth credential is reported as `OpenAI oauth`.
- Confirmed OpenAI OAuth model discovery returns subscription-compatible models.
- Confirmed the OAuth named volume is writable by container UID 1001 and survives container recreation.

An actual request using the user's ChatGPT Plus account was not run locally because only the user can complete the OAuth authorization.

## Current EC2 Action

The user attempted OAuth before the OAuth migration commit had been pushed and received:

```text
error while interpolating services.app.environment.OPENCODE_API_KEY: required variable OPENCODE_API_KEY is missing a value
```

Commit `c6db62d` fixes that problem and is now on `origin/main`. The EC2 deployment still needs to pull and apply it.

Run on EC2:

```bash
cd /home/ubuntu/opencode_frontend
git pull
git log -1 --oneline
```

The last command should show `c6db62d` or a newer commit.

Set these provider values in the existing private `.env`. Keep the existing admin credentials, app secret, and Cloudflare token unchanged.

```env
OPENCODE_PROVIDER=openai
OPENCODE_MODEL=openai/gpt-5.4
OPENCODE_MODEL_OPTIONS=
OPENCODE_API_KEY=
OPENCODE_TIMEOUT_MS=600000
```

Rebuild and recreate the services:

```bash
docker compose --profile tunnel up --build --force-recreate -d
```

Complete the one-time headless OAuth flow:

```bash
docker compose exec app opencode auth login --provider openai --method "ChatGPT Pro/Plus (headless)"
```

Open the displayed device URL on a trusted computer, enter the one-time code, and authenticate using the ChatGPT Plus account. Do not store the displayed code in this repository.

Verify the result:

```bash
docker compose exec app opencode auth list
docker compose exec app opencode models openai --refresh
docker compose exec app opencode run --model openai/gpt-5.4 "用繁體中文回覆：OAuth 已完成"
```

Expected credential output includes:

```text
OpenAI oauth
```

Restart and inspect logs:

```bash
docker compose --profile tunnel restart app
docker compose logs -f app cloudflared
```

Do not run `docker compose down -v`; it deletes both the OAuth credential volume and chat workspace volume. Plain `docker compose down` preserves named volumes.

## Model Guidance

Available ChatGPT OAuth model IDs are discovered dynamically and may change with OpenCode and the subscription. At the time of local verification, useful choices included:

| Task | Suggested model |
| --- | --- |
| General questions, summaries, Office work, and research | `openai/gpt-5.4` |
| Faster and lighter repetitive work | `openai/gpt-5.4-mini` |
| Repository work, scripts, and complex Excel automation | `openai/gpt-5.3-codex-spark` |
| Difficult reasoning and review | `openai/gpt-5.5`, if listed for the account |

Office generation depends on OpenCode tools and installed Python libraries, not a special Office model. Text PDFs are converted to text sidecars. Image analysis depends on model input capabilities. ChatGPT website image generation, custom GPTs, memory, and connectors are not automatically exposed by OpenCode OAuth.

## Security Notes

- Never commit `.env`, `auth.json`, API keys, passwords, cookies, OAuth tokens, or device codes.
- The ChatGPT subscription should only back this private single-account deployment, not a shared public API for unrelated users.
- Changing `ADMIN_PASSWORD` invalidates current web sessions.
- Rotating `APP_SECRET` invalidates all web sessions.
- Keep EC2 port 3000 private; Cloudflare Tunnel connects outbound to `app:3000`.

## Follow-up Ideas

- Confirm the real EC2 OAuth request and browser chat work end to end.
- Add OCR for scanned PDFs only if the larger image size and CPU cost are acceptable.
- Add a separate image-generation API/tool if generated images are required.
- Consider an authenticated provider-status endpoint so the UI can distinguish "OAuth login missing" from a model request failure before chat starts.
