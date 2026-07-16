using System.Text.Json;
using System.Text.Json.Nodes;

namespace AIChatBox.Launcher;

internal sealed class ApiKeyStore
{
    private readonly LauncherPaths _paths;

    public ApiKeyStore(LauncherPaths paths)
    {
        _paths = paths;
    }

    public bool HasUsableKey()
    {
        try
        {
            var root = JsonNode.Parse(File.ReadAllText(_paths.AuthFile));
            var key = root?["opencode-go"]?["key"]?.GetValue<string>();
            return !string.IsNullOrWhiteSpace(key) && key != "sk-XXXXXX";
        }
        catch
        {
            return false;
        }
    }

    public string GetMaskedKey()
    {
        try
        {
            var root = JsonNode.Parse(File.ReadAllText(_paths.AuthFile));
            var key = root?["opencode-go"]?["key"]?.GetValue<string>() ?? "";
            return key.Length > 8 ? $"{key[..4]}...{key[^4..]}" : "尚未設定";
        }
        catch
        {
            return "尚未設定";
        }
    }

    public void Save(string key)
    {
        var trimmed = key.Trim();
        if (trimmed.Length < 8 || trimmed.Contains('\n') || trimmed.Contains('\r'))
        {
            throw new ArgumentException("API key 格式不正確。");
        }

        var payload = new Dictionary<string, object>
        {
            ["opencode-go"] = new
            {
                type = "api",
                key = trimmed
            }
        };
        var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true });
        var temporaryFile = _paths.AuthFile + ".tmp";
        File.WriteAllText(temporaryFile, json);
        File.Move(temporaryFile, _paths.AuthFile, overwrite: true);
    }
}
