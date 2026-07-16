using System.Diagnostics;

namespace AIChatBox.Launcher;

internal sealed class DockerService
{
    private readonly LauncherPaths _paths;
    private string? _dockerCli;

    public DockerService(LauncherPaths paths)
    {
        _paths = paths;
    }

    public bool IsDockerInstalled => FindDockerCli() is not null && FindDockerDesktop() is not null;

    public async Task EnsureDockerReadyAsync(Action<string> status, CancellationToken cancellationToken)
    {
        _dockerCli = FindDockerCli() ?? throw new InvalidOperationException("尚未安裝 Docker Desktop。");

        if (await IsEngineReadyAsync(cancellationToken))
        {
            return;
        }

        var desktop = FindDockerDesktop() ?? throw new InvalidOperationException("找不到 Docker Desktop。");
        status("正在啟動 Docker Desktop...");
        Process.Start(new ProcessStartInfo
        {
            FileName = desktop,
            UseShellExecute = true
        });

        var deadline = DateTime.UtcNow.AddMinutes(3);
        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (await IsEngineReadyAsync(cancellationToken))
            {
                return;
            }

            await Task.Delay(TimeSpan.FromSeconds(2), cancellationToken);
        }

        throw new TimeoutException("Docker Desktop 啟動逾時。請確認 WSL 2、虛擬化與 Docker Desktop 授權畫面。 ");
    }

    public async Task StartStackAsync(Action<string> status, CancellationToken cancellationToken)
    {
        var docker = _dockerCli ?? FindDockerCli() ?? throw new InvalidOperationException("找不到 docker.exe。");
        if (!File.Exists(_paths.ComposeFile))
        {
            throw new FileNotFoundException("找不到 Windows Docker Compose 設定。", _paths.ComposeFile);
        }

        var environment = ComposeEnvironment();
        status("正在下載 AI ChatBox 服務...");
        var pull = await ProcessRunner.RunAsync(
            docker,
            ComposeArguments("pull"),
            AppContext.BaseDirectory,
            TimeSpan.FromMinutes(10),
            environment,
            cancellationToken);
        if (pull.ExitCode != 0)
        {
            throw new InvalidOperationException(UsefulError("無法下載 AI ChatBox image。", pull));
        }

        status("正在啟動 AI ChatBox...");
        var up = await ProcessRunner.RunAsync(
            docker,
            ComposeArguments("up", "--detach", "--wait", "--wait-timeout", "180"),
            AppContext.BaseDirectory,
            TimeSpan.FromMinutes(5),
            environment,
            cancellationToken);
        if (up.ExitCode != 0)
        {
            throw new InvalidOperationException(UsefulError("AI ChatBox 啟動失敗。", up));
        }
    }

    public async Task StopStackAsync(CancellationToken cancellationToken)
    {
        var docker = _dockerCli ?? FindDockerCli();
        if (docker is null || !File.Exists(_paths.ComposeFile))
        {
            return;
        }

        await ProcessRunner.RunAsync(
            docker,
            ComposeArguments("stop"),
            AppContext.BaseDirectory,
            TimeSpan.FromMinutes(2),
            ComposeEnvironment(),
            cancellationToken);
    }

    private async Task<bool> IsEngineReadyAsync(CancellationToken cancellationToken)
    {
        var docker = _dockerCli ?? FindDockerCli();
        if (docker is null)
        {
            return false;
        }

        try
        {
            var result = await ProcessRunner.RunAsync(
                docker,
                ["--context", "desktop-linux", "info", "--format", "{{.ServerVersion}}"],
                AppContext.BaseDirectory,
                TimeSpan.FromSeconds(8),
                cancellationToken: cancellationToken);
            return result.ExitCode == 0 && !string.IsNullOrWhiteSpace(result.Output);
        }
        catch
        {
            return false;
        }
    }

    private string[] ComposeArguments(params string[] command)
    {
        return [
            "--context", "desktop-linux",
            "compose",
            "--project-name", "ai-chatbox",
            "--project-directory", AppContext.BaseDirectory,
            "--file", _paths.ComposeFile,
            .. command
        ];
    }

    private Dictionary<string, string?> ComposeEnvironment()
    {
        return new Dictionary<string, string?>
        {
            ["AI_CHATBOX_DATA_DIR"] = _paths.DataDirectory,
            ["AI_CHATBOX_AUTH_DIR"] = _paths.AuthDirectory,
            ["AI_CHATBOX_RUNTIME_ENV"] = _paths.RuntimeEnvironmentFile
        };
    }

    private static string UsefulError(string message, ProcessResult result)
    {
        var detail = string.IsNullOrWhiteSpace(result.Error) ? result.Output : result.Error;
        return $"{message}{Environment.NewLine}{detail.Trim()}";
    }

    private static string? FindDockerDesktop()
    {
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Docker", "Docker", "Docker Desktop.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Docker Desktop", "Docker Desktop.exe")
        };
        return candidates.FirstOrDefault(File.Exists);
    }

    private static string? FindDockerCli()
    {
        var candidates = new List<string>
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Docker", "Docker", "resources", "bin", "docker.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Docker Desktop", "resources", "bin", "docker.exe")
        };

        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        candidates.AddRange(path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries).Select(folder => Path.Combine(folder.Trim('"'), "docker.exe")));
        return candidates.FirstOrDefault(File.Exists);
    }
}
