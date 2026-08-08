using System.IO;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices;

namespace MsdPpTools.Desktop.Plugins;

public sealed record PluginTypeInfo(string TypeName, string FriendlyName);

public sealed record AssemblyInspectionResult(
    string Name,
    string Version,
    string Culture,
    string PublicKeyToken,
    string ContentBase64,
    IReadOnlyList<PluginTypeInfo> PluginTypes);

/// <summary>Reads a plugin DLL's identity and finds its IPlugin-implementing types, without ever
/// executing the DLL's code. Uses <see cref="MetadataLoadContext"/> (metadata-only reflection) —
/// never <see cref="Assembly.Load"/> — because plugin DLLs reference Microsoft.Xrm.Sdk.dll and
/// other assemblies that don't exist in this desktop process, and a normal Load would throw.</summary>
public static class PluginAssemblyInspector
{
    private const string IPluginFullName = "Microsoft.Xrm.Sdk.IPlugin";

    public static AssemblyInspectionResult Inspect(string filePath)
    {
        var contentBase64 = Convert.ToBase64String(File.ReadAllBytes(filePath));

        var resolver = BuildResolver(filePath);
        using var mlc = new MetadataLoadContext(resolver, coreAssemblyName: "System.Private.CoreLib");
        var asm = mlc.LoadFromAssemblyPath(filePath);
        var name = asm.GetName();

        var publicKeyToken = name.GetPublicKeyToken() is { Length: > 0 } tokenBytes
            ? Convert.ToHexStringLower(tokenBytes)
            : "";

        // Lazily opened only if a type's interface walk needs the metadata-fallback tier —
        // most assemblies never hit this path.
        MetadataFallbackReader? fallback = null;
        try
        {
            var pluginTypes = new List<PluginTypeInfo>();
            foreach (var type in EnumerateLoadableTypes(asm))
            {
                if (type is null || !type.IsPublic || type.IsAbstract || type.IsInterface) continue;

                bool implementsIPlugin;
                try
                {
                    implementsIPlugin = type.GetInterfaces().Any(i => i.FullName == IPluginFullName);
                }
                catch (Exception ex) when (ex is FileNotFoundException or FileLoadException or TypeLoadException)
                {
                    fallback ??= new MetadataFallbackReader(filePath);
                    implementsIPlugin = fallback.ImplementsIPlugin(type.MetadataToken);
                }

                if (implementsIPlugin)
                {
                    pluginTypes.Add(new PluginTypeInfo(type.FullName ?? type.Name, type.Name));
                }
            }

            return new AssemblyInspectionResult(
                name.Name ?? Path.GetFileNameWithoutExtension(filePath),
                (name.Version ?? new Version(1, 0, 0, 0)).ToString(),
                string.IsNullOrEmpty(name.CultureName) ? "neutral" : name.CultureName,
                publicKeyToken,
                contentBase64,
                pluginTypes);
        }
        finally
        {
            fallback?.Dispose();
        }
    }

    private static IEnumerable<Type?> EnumerateLoadableTypes(Assembly asm)
    {
        try
        {
            return asm.GetTypes();
        }
        catch (ReflectionTypeLoadException ex)
        {
            // Some types in the assembly reference things we can't resolve — the ones that DID
            // load (non-null entries) are still worth scanning.
            return ex.Types;
        }
    }

    /// <summary>Seeds a <see cref="PathAssemblyResolver"/> with (a) the current runtime's own
    /// assemblies, (b) a bundled reference copy of Microsoft.Xrm.Sdk.dll (needed to resolve the
    /// IPlugin interface — plugin projects normally don't ship it alongside the compiled DLL,
    /// since Dataverse supplies it at execution time), (c) the target DLL's own directory, and
    /// (d) the target DLL itself. Simple names must be unique for PathAssemblyResolver, so later
    /// entries intentionally overwrite earlier ones — target-dir copies win over the bundled SDK
    /// copy, which wins over the runtime directory.</summary>
    private static PathAssemblyResolver BuildResolver(string filePath)
    {
        var byName = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        var tpaRaw = AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") as string;
        var runtimePaths = !string.IsNullOrEmpty(tpaRaw)
            ? tpaRaw.Split(Path.PathSeparator)
            : Directory.GetFiles(RuntimeEnvironment.GetRuntimeDirectory(), "*.dll");
        foreach (var p in runtimePaths)
        {
            byName[Path.GetFileNameWithoutExtension(p)] = p;
        }

        var bundledSdkPath = Path.Combine(AppContext.BaseDirectory, "ReferenceAssemblies", "Microsoft.Xrm.Sdk.dll");
        if (File.Exists(bundledSdkPath))
        {
            byName["Microsoft.Xrm.Sdk"] = bundledSdkPath;
        }

        var targetDir = Path.GetDirectoryName(Path.GetFullPath(filePath));
        if (targetDir is not null && Directory.Exists(targetDir))
        {
            foreach (var p in Directory.GetFiles(targetDir, "*.dll"))
            {
                byName[Path.GetFileNameWithoutExtension(p)] = p;
            }
        }

        byName[Path.GetFileNameWithoutExtension(filePath)] = filePath;

        return new PathAssemblyResolver(byName.Values);
    }

    /// <summary>Tier-2 fallback: reads a type's <c>InterfaceImplementation</c> metadata rows
    /// directly (via System.Reflection.Metadata, the same library MetadataLoadContext itself is
    /// built on) instead of asking the runtime to resolve the interface's declaring assembly.
    /// Recurses into same-assembly base classes. Known limitation: a plugin type whose base class
    /// lives in a third, unresolvable assembly (neither this DLL nor Microsoft.Xrm.Sdk) can't be
    /// followed this way either — both tiers hit the same wall there.</summary>
    private sealed class MetadataFallbackReader : IDisposable
    {
        private readonly FileStream _stream;
        private readonly PEReader _peReader;
        private readonly MetadataReader _reader;
        private readonly Dictionary<TypeDefinitionHandle, bool> _memo = new();

        public MetadataFallbackReader(string filePath)
        {
            _stream = File.OpenRead(filePath);
            _peReader = new PEReader(_stream);
            _reader = _peReader.GetMetadataReader();
        }

        public bool ImplementsIPlugin(int metadataToken)
        {
            var handle = MetadataTokens.EntityHandle(metadataToken);
            return handle.Kind == HandleKind.TypeDefinition && ImplementsIPlugin((TypeDefinitionHandle)handle, new HashSet<TypeDefinitionHandle>());
        }

        private bool ImplementsIPlugin(TypeDefinitionHandle handle, HashSet<TypeDefinitionHandle> visiting)
        {
            if (_memo.TryGetValue(handle, out var cached)) return cached;
            if (!visiting.Add(handle)) return false; // defensive: cyclical base chain shouldn't happen, but don't hang if it does

            var typeDef = _reader.GetTypeDefinition(handle);

            foreach (var implHandle in typeDef.GetInterfaceImplementations())
            {
                var impl = _reader.GetInterfaceImplementation(implHandle);
                if (IsIPluginReference(impl.Interface))
                {
                    _memo[handle] = true;
                    return true;
                }
            }

            var result = false;
            if (!typeDef.BaseType.IsNil && typeDef.BaseType.Kind == HandleKind.TypeDefinition)
            {
                result = ImplementsIPlugin((TypeDefinitionHandle)typeDef.BaseType, visiting);
            }

            _memo[handle] = result;
            return result;
        }

        private bool IsIPluginReference(EntityHandle handle)
        {
            if (handle.Kind != HandleKind.TypeReference) return false;
            var typeRef = _reader.GetTypeReference((TypeReferenceHandle)handle);
            return _reader.GetString(typeRef.Namespace) == "Microsoft.Xrm.Sdk"
                && _reader.GetString(typeRef.Name) == "IPlugin";
        }

        public void Dispose()
        {
            _peReader.Dispose();
            _stream.Dispose();
        }
    }
}
