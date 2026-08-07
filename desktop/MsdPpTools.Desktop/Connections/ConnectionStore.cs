using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MsdPpTools.Desktop.Connections;

/// <summary>Reads/writes %AppData%\MsdPpTools\connections.json. Deals purely in the on-disk
/// representation (secrets stay DPAPI-encrypted) — decrypting a secret is AuthService's job,
/// done only at the moment a token is actually acquired.</summary>
public sealed class ConnectionStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    private readonly string _filePath;

    public ConnectionStore()
    {
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MsdPpTools");
        Directory.CreateDirectory(dir);
        _filePath = Path.Combine(dir, "connections.json");
    }

    public List<Connection> Load()
    {
        if (!File.Exists(_filePath))
        {
            return [];
        }

        var json = File.ReadAllText(_filePath);
        return JsonSerializer.Deserialize<List<Connection>>(json, JsonOptions) ?? [];
    }

    public void Save(List<Connection> connections)
    {
        var json = JsonSerializer.Serialize(connections, JsonOptions);
        File.WriteAllText(_filePath, json);
    }

    public Connection Add(Connection connection)
    {
        var all = Load();
        all.Add(connection);
        Save(all);
        return connection;
    }

    public void Remove(string id)
    {
        var all = Load();
        all.RemoveAll(c => c.Id == id);
        Save(all);
    }

    public Connection? FindById(string id)
    {
        return Load().FirstOrDefault(c => c.Id == id);
    }
}
