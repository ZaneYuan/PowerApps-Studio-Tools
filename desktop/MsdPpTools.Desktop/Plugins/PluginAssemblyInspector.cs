using System.IO;
using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;

namespace MsdPpTools.Desktop.Plugins;

public sealed record PluginTypeInfo(string TypeName, string FriendlyName);

public sealed record AssemblyInspectionResult(
    string Name,
    string Version,
    string Culture,
    string PublicKeyToken,
    string ContentBase64,
    IReadOnlyList<PluginTypeInfo> PluginTypes);

/// <summary>Reads a plugin DLL's identity and finds its IPlugin-implementing types by reading ECMA-335
/// metadata tables directly, without loading or executing the DLL. Deliberately avoids
/// MetadataLoadContext: it needs a physical System.Private.CoreLib.dll, which a self-contained
/// single-file publish doesn't have on disk. Base classes and interfaces defined in other DLLs are
/// followed when those DLLs sit next to the inspected file.</summary>
public static class PluginAssemblyInspector
{
    public static AssemblyInspectionResult Inspect(string filePath)
    {
        var fullPath = Path.GetFullPath(filePath);
        var contentBase64 = Convert.ToBase64String(File.ReadAllBytes(fullPath));

        using var resolver = new MetadataTypeResolver(Path.GetDirectoryName(fullPath));
        var module = resolver.Open(fullPath);
        var reader = module.Reader;
        if (!reader.IsAssembly)
        {
            throw new InvalidOperationException("所选文件不是 .NET 程序集。");
        }

        var name = reader.GetAssemblyDefinition().GetAssemblyName();
        var publicKeyToken = name.GetPublicKeyToken() is { Length: > 0 } tokenBytes
            ? Convert.ToHexStringLower(tokenBytes)
            : "";

        var pluginTypes = new List<PluginTypeInfo>();
        foreach (var handle in reader.TypeDefinitions)
        {
            var typeDef = reader.GetTypeDefinition(handle);
            var attributes = typeDef.Attributes;
            if ((attributes & TypeAttributes.VisibilityMask) != TypeAttributes.Public) continue;
            if ((attributes & (TypeAttributes.Abstract | TypeAttributes.Interface)) != 0) continue;

            if (resolver.ImplementsIPlugin(module, handle))
            {
                var typeName = reader.GetString(typeDef.Name);
                var ns = reader.GetString(typeDef.Namespace);
                pluginTypes.Add(new PluginTypeInfo(ns.Length == 0 ? typeName : $"{ns}.{typeName}", typeName));
            }
        }

        return new AssemblyInspectionResult(
            name.Name ?? Path.GetFileNameWithoutExtension(fullPath),
            (name.Version ?? new Version(1, 0, 0, 0)).ToString(),
            string.IsNullOrEmpty(name.CultureName) ? "neutral" : name.CultureName,
            publicKeyToken,
            contentBase64,
            pluginTypes);
    }

    private sealed class MetadataModule(PEReader peReader)
    {
        public PEReader PeReader { get; } = peReader;
        public MetadataReader Reader { get; } = peReader.GetMetadataReader();
    }

    private sealed class MetadataTypeResolver(string? directory) : IDisposable
    {
        private const string IPluginNamespace = "Microsoft.Xrm.Sdk";
        private const string IPluginName = "IPlugin";

        private readonly Dictionary<string, MetadataModule?> _modulesByPath = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<(MetadataModule, TypeDefinitionHandle), bool> _memo = new();

        public MetadataModule Open(string path)
        {
            var module = TryOpen(path);
            return module ?? throw new InvalidOperationException("所选文件不是有效的 .NET 程序集。");
        }

        public bool ImplementsIPlugin(MetadataModule module, TypeDefinitionHandle handle) =>
            ImplementsIPlugin(module, handle, new HashSet<(MetadataModule, TypeDefinitionHandle)>());

        private bool ImplementsIPlugin(MetadataModule module, TypeDefinitionHandle handle, HashSet<(MetadataModule, TypeDefinitionHandle)> visiting)
        {
            var key = (module, handle);
            if (_memo.TryGetValue(key, out var cached)) return cached;
            if (!visiting.Add(key)) return false;

            var reader = module.Reader;
            var typeDef = reader.GetTypeDefinition(handle);
            var result = false;

            foreach (var implHandle in typeDef.GetInterfaceImplementations())
            {
                if (TypeImplementsIPlugin(module, reader.GetInterfaceImplementation(implHandle).Interface, visiting))
                {
                    result = true;
                    break;
                }
            }

            if (!result && !typeDef.BaseType.IsNil)
            {
                result = TypeImplementsIPlugin(module, typeDef.BaseType, visiting);
            }

            _memo[key] = result;
            return result;
        }

        /// <summary>True when <paramref name="handle"/> is IPlugin itself or a type (class or
        /// interface) that implements it.</summary>
        private bool TypeImplementsIPlugin(MetadataModule module, EntityHandle handle, HashSet<(MetadataModule, TypeDefinitionHandle)> visiting)
        {
            var reader = module.Reader;
            switch (handle.Kind)
            {
                case HandleKind.TypeDefinition:
                    return ImplementsIPlugin(module, (TypeDefinitionHandle)handle, visiting);

                case HandleKind.TypeReference:
                {
                    var typeRef = reader.GetTypeReference((TypeReferenceHandle)handle);
                    var ns = reader.GetString(typeRef.Namespace);
                    var name = reader.GetString(typeRef.Name);
                    if (ns == IPluginNamespace && name == IPluginName) return true;
                    return ResolveTypeReference(module, typeRef) is { } target
                        && ImplementsIPlugin(target.Module, target.Handle, visiting);
                }

                case HandleKind.TypeSpecification:
                {
                    // A generic base such as PluginBase<T>: the blob is GENERICINST CLASS <type> <args>.
                    var spec = reader.GetTypeSpecification((TypeSpecificationHandle)handle);
                    var blob = reader.GetBlobReader(spec.Signature);
                    if (blob.ReadSignatureTypeCode() != SignatureTypeCode.GenericTypeInstance) return false;
                    blob.ReadSignatureTypeCode();
                    return TypeImplementsIPlugin(module, blob.ReadTypeHandle(), visiting);
                }

                default:
                    return false;
            }
        }

        private (MetadataModule Module, TypeDefinitionHandle Handle)? ResolveTypeReference(MetadataModule module, TypeReference typeRef)
        {
            var reader = module.Reader;
            if (typeRef.ResolutionScope.Kind != HandleKind.AssemblyReference || directory is null) return null;

            var asmRef = reader.GetAssemblyReference((AssemblyReferenceHandle)typeRef.ResolutionScope);
            var target = TryOpen(Path.Combine(directory, reader.GetString(asmRef.Name) + ".dll"));
            if (target is null) return null;

            var ns = reader.GetString(typeRef.Namespace);
            var name = reader.GetString(typeRef.Name);
            var targetReader = target.Reader;
            foreach (var candidate in targetReader.TypeDefinitions)
            {
                var def = targetReader.GetTypeDefinition(candidate);
                if (targetReader.GetString(def.Name) == name && targetReader.GetString(def.Namespace) == ns)
                {
                    return (target, candidate);
                }
            }
            return null;
        }

        private MetadataModule? TryOpen(string path)
        {
            if (_modulesByPath.TryGetValue(path, out var existing)) return existing;

            MetadataModule? module = null;
            if (File.Exists(path))
            {
                var peReader = new PEReader(File.OpenRead(path));
                if (peReader.HasMetadata)
                {
                    module = new MetadataModule(peReader);
                }
                else
                {
                    peReader.Dispose();
                }
            }
            _modulesByPath[path] = module;
            return module;
        }

        public void Dispose()
        {
            foreach (var module in _modulesByPath.Values)
            {
                module?.PeReader.Dispose();
            }
        }
    }
}
