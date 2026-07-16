# AI ChatBox for Windows

This branch packages AI ChatBox as a Windows 10/11 x64 desktop application. The launcher embeds the web interface with WebView2 and manages the Docker Desktop service in the background.

## User Requirements

- Windows 10 or Windows 11 x64.
- Docker Desktop with the WSL 2 backend.
- Hardware virtualization enabled.
- An OpenCode Go API key.

Node.js, Python, Git, and the opencode CLI are not required on the Windows host. They are included in the Docker image.

## Installation

1. Install and start [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. Download `AIChatBox-Setup-win-x64.exe` from the GitHub Actions artifact or release.
3. Run the installer and launch `AI ChatBox` from the desktop or Start menu.
4. Enter the OpenCode Go API key when prompted.
5. Wait while Docker Desktop starts and downloads the AI ChatBox image.

The first launch downloads the container image and takes longer. Later launches reuse the local image.

## Application Behavior

The launcher:

- Checks whether Docker Desktop is installed.
- Starts Docker Desktop when its Linux engine is not ready.
- Pulls `ghcr.io/nichodelightful/opencode_frontend:windows`.
- Starts the container on `127.0.0.1:3000` only.
- Waits for `/api/health` before showing the chat interface.
- Displays the interface in an embedded WebView2 window.
- Lets the user change the API key, restart the service, or stop the service.

Closing the launcher asks whether the AI ChatBox container should also stop. Docker Desktop itself is not stopped because other applications may use it.

## Local Data

User data is stored outside the installation directory:

```text
%LOCALAPPDATA%\AIChatBox\
  data\workspaces\
  secrets\opencode\auth.json
  runtime.env
  WebView2\
  logs\
```

Chat history, uploaded files, and generated documents remain under `data\workspaces` when the application or container is updated.

The API key remains in `secrets\opencode\auth.json`. It is not included in the installer or Docker image.

## Building in GitHub Actions

Push the `windows` branch. The `Build Windows Distribution` workflow will:

1. Build the Linux AMD64 Docker image used by Docker Desktop.
2. Push the image to `ghcr.io/nichodelightful/opencode_frontend:windows`.
3. Publish the WPF launcher as a self-contained `win-x64` application.
4. Download the WebView2 Evergreen bootstrapper.
5. Build `AIChatBox-Setup-win-x64.exe` with Inno Setup.
6. Upload the launcher and installer as workflow artifacts.

After the first image publication, set the GHCR package visibility to **Public**. Otherwise an end user's Docker Desktop cannot pull the image without GitHub authentication.

## Building on a Windows Development Machine

Requirements:

- .NET 8 SDK
- Inno Setup 6

Publish the launcher:

```powershell
dotnet publish .\launcher\AIChatBox.Launcher\AIChatBox.Launcher.csproj `
  --configuration Release `
  --runtime win-x64 `
  --self-contained true `
  --output .\artifacts\launcher
```

Download the WebView2 bootstrapper to:

```text
artifacts\installer-deps\MicrosoftEdgeWebview2Setup.exe
```

Build the installer:

```powershell
& "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" .\installer\AIChatBox.iss
```

## Security Notes

- The service binds only to localhost and is not exposed to the LAN by default.
- The launcher executes `docker.exe` directly with an argument list. It does not pass user input through `cmd.exe` or PowerShell.
- Do not put a real API key in source code, Git, the installer, or the container image.
- An unsigned installer may show Windows SmartScreen's `Unknown publisher` warning. A trusted code-signing certificate is required to remove that warning for normal distribution.

## Troubleshooting

If Docker Desktop is installed but startup times out:

- Open Docker Desktop manually and accept its license or first-run prompts.
- Confirm WSL 2 and virtualization are enabled.
- Confirm Docker Desktop is using Linux containers.
- Run the launcher again after Docker Desktop shows `Engine running`.

If the image cannot be downloaded:

- Confirm Internet access.
- Confirm `ghcr.io/nichodelightful/opencode_frontend` is public.
- Check whether a corporate proxy or firewall blocks GHCR.
