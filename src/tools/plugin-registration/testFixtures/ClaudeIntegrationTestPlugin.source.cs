// Source for the sibling ClaudeIntegrationTestPlugin.dll fixture used by
// dataverseOps.integration.test.ts to exercise registerAssembly/updateAssembly against a real
// plugin assembly. Three real API constraints were confirmed the hard way while building this:
//   1. pluginassemblies.content POST validates the upload is a real, loadable .NET assembly — an
//      arbitrary base64 blob 400s.
//   2. plugintypes POST validates the type name against the assembly's actual server-side
//      reflected types — a net10.0-targeted DLL with a plain class (no IPlugin) registered fine as
//      an *assembly* but then plugintypes 400'd with "has a total of [0] plugin/workflow activity
//      types", because Dataverse's reflection loader found no recognizable plugin types at all.
//   3. isolationmode: 2 (Sandbox — the mode this app's own registerAssembly always uses) requires
//      a strong-named assembly — an unsigned one 400s with "Public assembly must have public key
//      token."
// So this fixture is a real, strong-named Microsoft.Xrm.Sdk.IPlugin implementation targeting
// net462 (the classic sandbox-compatible framework), referencing the real
// Microsoft.CrmSdk.CoreAssemblies NuGet package (v9.0.2.51) — not a duck-typed same-named
// interface. Its real public key token is d6706004015b6e60 (the integration test's
// `publicKeyToken` input must match this exactly, same as version/culture).
//
// It is still never actually *invoked*: every step the integration test registers against it
// targets a message on a throwaway custom table nothing else ever writes to, so the sandbox never
// needs to load and execute it.
//
// Rebuild with (from a scratch directory):
//   dotnet new classlib -n ClaudeIntegrationTestPlugin -o .
//   dotnet add package Microsoft.CrmSdk.CoreAssemblies --version 9.0.2.51
//   sn.exe -k ClaudeIntegrationTestPlugin.snk   (any installed .NET Framework SDK's sn.exe works,
//                                                 e.g. under "Microsoft SDKs\Windows\...\bin\...")
//   (edit the .csproj: <TargetFramework>net462</TargetFramework>, add
//    <SignAssembly>true</SignAssembly> and
//    <AssemblyOriginatorKeyFile>ClaudeIntegrationTestPlugin.snk</AssemblyOriginatorKeyFile>)
//   (replace the generated Class1.cs with this file's content)
//   dotnet build -c Release
//   sn.exe -Tp bin/Release/net462/ClaudeIntegrationTestPlugin.dll   (re-read the public key token
//                                                                     if the .snk changed)
//   copy bin/Release/net462/ClaudeIntegrationTestPlugin.dll over the sibling .dll here
using System;
using Microsoft.Xrm.Sdk;

namespace ClaudeIntegrationTestPlugin
{
    public class NoOpPlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider) { }
    }

    // Exists solely so updateAssembly's integration test can register a genuinely new,
    // real, reflectable type without needing a second DLL build.
    public class SecondPlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider) { }
    }
}
