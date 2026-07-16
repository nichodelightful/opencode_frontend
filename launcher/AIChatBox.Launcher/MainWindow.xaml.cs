using System.ComponentModel;
using System.Diagnostics;
using System.Net.Http;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace AIChatBox.Launcher;

public partial class MainWindow : Window
{
    private static readonly Uri AppUri = new("http://localhost:3000");
    private static readonly Uri HealthUri = new("http://localhost:3000/api/health");
    private readonly LauncherPaths _paths = new();
    private readonly HttpClient _httpClient = new() { Timeout = TimeSpan.FromSeconds(5) };
    private readonly CancellationTokenSource _lifetime = new();
    private DockerService? _docker;
    private ApiKeyStore? _keyStore;
    private bool _allowClose;
    private bool _startupRunning;

    public MainWindow()
    {
        InitializeComponent();
    }

    private async void Window_Loaded(object sender, RoutedEventArgs e)
    {
        _paths.EnsureDirectories();
        _paths.EnsureRuntimeEnvironment();
        _docker = new DockerService(_paths);
        _keyStore = new ApiKeyStore(_paths);
        await StartApplicationAsync();
    }

    private async Task StartApplicationAsync()
    {
        if (_startupRunning || _docker is null || _keyStore is null)
        {
            return;
        }

        _startupRunning = true;
        ShowStartup("正在檢查設定...");
        RetryButton.Visibility = Visibility.Collapsed;
        InstallDockerButton.Visibility = Visibility.Collapsed;
        StartupError.Text = "";

        try
        {
            if (!_keyStore.HasUsableKey())
            {
                var dialog = new ApiKeyDialog(_keyStore) { Owner = this };
                if (dialog.ShowDialog() != true)
                {
                    throw new InvalidOperationException("需要設定 OpenCode Go API key 才能啟動。");
                }
            }

            if (!_docker.IsDockerInstalled)
            {
                InstallDockerButton.Visibility = Visibility.Visible;
                throw new InvalidOperationException("這台電腦尚未安裝 Docker Desktop。");
            }

            await _docker.EnsureDockerReadyAsync(SetStatus, _lifetime.Token);
            await _docker.StartStackAsync(SetStatus, _lifetime.Token);
            SetStatus("正在等待 AI ChatBox 服務...");
            await WaitForHealthAsync(_lifetime.Token);
            await InitializeBrowserAsync();
            HeaderStatus.Text = "服務已就緒";
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            StartupProgress.IsIndeterminate = false;
            StartupError.Text = exception.Message;
            HeaderStatus.Text = "啟動失敗";
            RetryButton.Visibility = Visibility.Visible;
        }
        finally
        {
            _startupRunning = false;
        }
    }

    private async Task InitializeBrowserAsync()
    {
        if (Browser.CoreWebView2 is null)
        {
            try
            {
                _ = CoreWebView2Environment.GetAvailableBrowserVersionString();
            }
            catch (WebView2RuntimeNotFoundException)
            {
                throw new InvalidOperationException("找不到 Microsoft Edge WebView2 Runtime。請先安裝 WebView2 Runtime。");
            }

            var environment = await CoreWebView2Environment.CreateAsync(null, _paths.WebViewDataDirectory);
            await Browser.EnsureCoreWebView2Async(environment);
            var coreWebView = Browser.CoreWebView2 ?? throw new InvalidOperationException("WebView2 初始化失敗。");
            coreWebView.NavigationStarting += (_, args) =>
            {
                if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var target) ||
                    (!target.IsLoopback || target.Port != 3000))
                {
                    args.Cancel = true;
                }
            };
            coreWebView.NewWindowRequested += (_, args) =>
            {
                args.Handled = true;
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var target) && target.Scheme is "https" or "http")
                {
                    Process.Start(new ProcessStartInfo(target.ToString()) { UseShellExecute = true });
                }
            };
            coreWebView.DownloadStarting += (_, args) =>
            {
                var downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
                Directory.CreateDirectory(downloads);
                args.ResultFilePath = Path.Combine(downloads, Path.GetFileName(args.ResultFilePath));
            };
        }

        Browser.Source = AppUri;
        StartupPanel.Visibility = Visibility.Collapsed;
        Browser.Visibility = Visibility.Visible;
    }

    private async Task WaitForHealthAsync(CancellationToken cancellationToken)
    {
        var deadline = DateTime.UtcNow.AddMinutes(3);
        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                using var response = await _httpClient.GetAsync(HealthUri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
                if (response.IsSuccessStatusCode)
                {
                    return;
                }
            }
            catch (HttpRequestException)
            {
            }
            catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
            }

            await Task.Delay(TimeSpan.FromSeconds(2), cancellationToken);
        }

        throw new TimeoutException("AI ChatBox 服務啟動逾時。");
    }

    private void ShowStartup(string status)
    {
        Browser.Visibility = Visibility.Collapsed;
        StartupPanel.Visibility = Visibility.Visible;
        StartupProgress.IsIndeterminate = true;
        StartupStatus.Text = status;
        HeaderStatus.Text = status;
    }

    private void SetStatus(string status)
    {
        Dispatcher.Invoke(() =>
        {
            StartupStatus.Text = status;
            HeaderStatus.Text = status;
        });
    }

    private async void Retry_Click(object sender, RoutedEventArgs e)
    {
        await StartApplicationAsync();
    }

    private async void Restart_Click(object sender, RoutedEventArgs e)
    {
        if (_docker is null) return;
        ShowStartup("正在重新啟動服務...");
        try
        {
            await _docker.StopStackAsync(_lifetime.Token);
            await StartApplicationAsync();
        }
        catch (Exception exception)
        {
            StartupError.Text = exception.Message;
            RetryButton.Visibility = Visibility.Visible;
        }
    }

    private async void Stop_Click(object sender, RoutedEventArgs e)
    {
        if (_docker is null) return;
        ShowStartup("正在停止 AI ChatBox...");
        try
        {
            await _docker.StopStackAsync(_lifetime.Token);
            StartupProgress.IsIndeterminate = false;
            StartupStatus.Text = "服務已停止。按「重試」即可重新啟動。";
            HeaderStatus.Text = "服務已停止";
            RetryButton.Visibility = Visibility.Visible;
        }
        catch (Exception exception)
        {
            StartupError.Text = exception.Message;
        }
    }

    private async void Settings_Click(object sender, RoutedEventArgs e)
    {
        if (_keyStore is null) return;
        var dialog = new ApiKeyDialog(_keyStore) { Owner = this };
        if (dialog.ShowDialog() == true && _docker is not null)
        {
            ShowStartup("設定已更新，正在重新啟動服務...");
            await _docker.StopStackAsync(_lifetime.Token);
            await StartApplicationAsync();
        }
    }

    private void InstallDocker_Click(object sender, RoutedEventArgs e)
    {
        Process.Start(new ProcessStartInfo("https://www.docker.com/products/docker-desktop/") { UseShellExecute = true });
    }

    private async void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (_allowClose)
        {
            return;
        }

        var result = MessageBox.Show(
            "是否同時停止 AI ChatBox 背景服務？\n\n選擇「否」可讓服務繼續執行。",
            "關閉 AI ChatBox",
            MessageBoxButton.YesNoCancel,
            MessageBoxImage.Question);
        if (result == MessageBoxResult.Cancel)
        {
            e.Cancel = true;
            return;
        }

        e.Cancel = true;
        IsEnabled = false;
        _lifetime.Cancel();

        if (result == MessageBoxResult.Yes && _docker is not null)
        {
            try
            {
                using var stopTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                await _docker.StopStackAsync(stopTimeout.Token);
            }
            catch
            {
            }
        }

        Browser.Dispose();
        _httpClient.Dispose();
        _allowClose = true;
        Close();
    }
}
