namespace AIChatBox.Launcher;

internal sealed class LauncherPaths
{
    public string Root { get; }
    public string DataDirectory { get; }
    public string AuthDirectory { get; }
    public string AuthFile { get; }
    public string LogsDirectory { get; }
    public string RuntimeEnvironmentFile { get; }
    public string WebViewDataDirectory { get; }
    public string ComposeFile { get; }

    public LauncherPaths()
    {
        Root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "AIChatBox");
        DataDirectory = Path.Combine(Root, "data", "workspaces");
        AuthDirectory = Path.Combine(Root, "secrets", "opencode");
        AuthFile = Path.Combine(AuthDirectory, "auth.json");
        LogsDirectory = Path.Combine(Root, "logs");
        RuntimeEnvironmentFile = Path.Combine(Root, "runtime.env");
        WebViewDataDirectory = Path.Combine(Root, "WebView2");
        ComposeFile = Path.Combine(AppContext.BaseDirectory, "runtime", "docker-compose.yml");
    }

    public void EnsureDirectories()
    {
        Directory.CreateDirectory(DataDirectory);
        Directory.CreateDirectory(AuthDirectory);
        Directory.CreateDirectory(LogsDirectory);
        Directory.CreateDirectory(WebViewDataDirectory);
    }

    public void EnsureRuntimeEnvironment()
    {
        if (File.Exists(RuntimeEnvironmentFile))
        {
            return;
        }

        var secret = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        File.WriteAllText(
            RuntimeEnvironmentFile,
            string.Join(
                Environment.NewLine,
                "OPENCODE_MODEL=opencode-go/deepseek-v4-flash",
                "OPENCODE_MODEL_OPTIONS=",
                "OPENCODE_TIMEOUT_MS=600000",
                $"APP_SECRET={secret}") + Environment.NewLine);
    }
}
