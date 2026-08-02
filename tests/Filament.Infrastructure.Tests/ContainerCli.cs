using System.Diagnostics;

namespace Filament.Infrastructure.Tests;

/// <summary>
/// Detects the container CLI the same way <c>scripts/e2e-cli.sh</c> does, so the Infrastructure
/// tests can spin up a disposable MariaDB container from inside a Fedora Silverblue toolbox
/// (<c>flatpak-spawn --host podman</c>) or a plain <c>podman</c>/<c>docker</c> environment.
/// </summary>
internal sealed class ContainerCli
{
    private readonly string[] _prefix;
    private ContainerCli(string[] prefix) => _prefix = prefix;

    public static ContainerCli Detect()
    {
        string[] prefix;
        if (InContainerOrToolbox() || OnPath("flatpak-spawn"))
        {
            prefix = new[] { "flatpak-spawn", "--host", "podman" };
        }
        else if (OnPath("podman"))
        {
            prefix = new[] { "podman" };
        }
        else if (OnPath("docker"))
        {
            prefix = new[] { "docker" };
        }
        else
        {
            throw new InvalidOperationException(
                "No supported container CLI found. Looked for: flatpak-spawn (toolbox), podman, docker. " +
                "On Fedora Silverblue, run inside a toolbox where flatpak-spawn can reach host podman.");
        }
        return new ContainerCli(prefix);
    }

    public string Description => string.Join(' ', _prefix);

    /// <summary>Runs the container CLI with the given args and returns (stdout, stderr, exit code).</summary>
    public (string stdout, string stderr, int exit) Run(params string[] args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = _prefix[0],
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (var a in _prefix.Skip(1)) psi.ArgumentList.Add(a);
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)
            ?? throw new InvalidOperationException($"Could not start '{_prefix[0]}'.");
        var stdout = p.StandardOutput.ReadToEnd();
        var stderr = p.StandardError.ReadToEnd();
        p.WaitForExit();
        return (stdout, stderr, p.ExitCode);
    }

    private static bool InContainerOrToolbox() =>
        File.Exists("/run/.containerenv") || File.Exists("/.dockerenv");

    private static bool OnPath(string exe)
    {
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var dir in path.Split(Path.PathSeparator))
        {
            if (string.IsNullOrEmpty(dir)) continue;
            try
            {
                if (File.Exists(Path.Combine(dir, exe))) return true;
            }
            catch { /* ignore */ }
        }
        return false;
    }
}
