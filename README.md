# Family AI Workbench

ChatGPT-style web UI for family AI tasks. The MVP runs as one Next.js container on EC2 and includes both the web page and API routes.

## Current Shape

- `src/app/page.tsx`: chat UI with drag-and-drop upload.
- `src/app/api/upload/route.ts`: stores uploaded files in a per-session workspace.
- `src/app/api/chat/route.ts`: mock chat endpoint with a clear TODO for the future opencode executor.
- `src/lib/workspace.ts`: workspace/session helpers.
- `Dockerfile` and `docker-compose.yml`: EC2 container deployment baseline.

## Runtime Plan

```text
Browser
  -> Cloudflare Access / Tunnel
  -> EC2 Docker container
  -> Next.js Web + API
  -> /data/workspaces/<session>/uploads
  -> future opencode executor
```

This starts as one service. If execution becomes slow or needs stronger isolation, split the opencode runner into a separate worker container later.

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Docker

Create your local env file first:

```bash
cp .env.example .env
nano .env
```

Then run:

```bash
docker compose up --build -d
```

The app listens on port `3000`. Uploaded files are stored in the named Docker volume `workspaces` at `/data/workspaces` inside the container.

If this host does not have the Docker Compose plugin, use plain Docker for a quick test:

```bash
docker build -t family-ai-workbench .
docker run --rm -p 3000:3000 --env-file .env -v family-ai-workspaces:/data/workspaces family-ai-workbench
```

## API Keys

Put API keys in `.env` on the EC2 host, never in source code. The container receives these values through `env_file` in `docker-compose.yml`.

Examples:

```bash
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
OPENROUTER_API_KEY=...
```

The exact key depends on the provider configured for opencode.

## Where opencode Goes

The current `/api/chat` endpoint is intentionally mocked. The intended integration point is `src/app/api/chat/route.ts`.

Recommended MVP approach:

1. Install opencode inside the app image or create a small wrapper script in the image.
2. Keep `OPENCODE_BIN=opencode` in `.env`, or set it to the wrapper path.
3. Spawn opencode from `/api/chat`, with the working directory set to the session workspace.
4. Pass provider keys through environment variables from `.env`.

Later, if isolation matters, move opencode into a separate worker container and let the Next.js API queue jobs for it.

## Next Steps

1. Replace the mock `/api/chat` response with an opencode subprocess scoped to the session workspace.
2. Add Server-Sent Events so opencode output streams back to the browser.
3. Add output file listing and download links.
4. Put Cloudflare Access in front and use its identity headers for family member separation.
5. Add cleanup for old workspace files.
# opencode_frontend
