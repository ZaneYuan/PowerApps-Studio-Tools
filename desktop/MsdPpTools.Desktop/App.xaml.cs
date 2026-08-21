using System.Configuration;
using System.Data;
using System.Threading.Tasks;
using System.Windows;
using MsdPpTools.Desktop.Update;

namespace MsdPpTools.Desktop;

/// <summary>
/// Interaction logic for App.xaml
/// </summary>
public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // The main window shows immediately, unconditionally — the update check runs after,
        // on a background thread. It used to run *before* MainWindow.Show(), gating every
        // single launch on it (git subprocess calls for UpdateChecker; a GitHub API round trip
        // for GitHubReleaseUpdateChecker) — on a slow network, or one that can't reach GitHub
        // at all (corporate firewall, no internet, revoked access), that meant a real,
        // user-visible delay before the app opened at all. Both checkers already fail safe
        // (bare try/catch -> false) so this was never a "the app won't open" risk, but it was
        // still real added latency on *every* launch for a check whose result is "no update"
        // the overwhelming majority of the time. Now a slow/unreachable network just means the
        // background check quietly times out a few seconds after the app is already open and
        // usable, instead of the user staring at nothing.
        new MainWindow().Show();

#if !DEBUG
        Task.Run(() =>
        {
            // Dev-machine path first (rebuilds from a local git checkout via publish.bat). The
            // GitHub-Releases path only runs when there's no .git/publish.bat next to the exe
            // (a real user's self-contained download) — not merely when the dev-machine check
            // found nothing to rebuild, since a dev checkout's version.txt can legitimately be
            // ahead of the latest tagged release and GitHubReleaseUpdateChecker has no way to
            // tell "ahead" from "behind" (see UpdateChecker.IsDevCheckout).
            var launchedUpdate = UpdateChecker.TryLaunchUpdateIfNeeded()
                || (!UpdateChecker.IsDevCheckout() && GitHubReleaseUpdateChecker.TryLaunchUpdateIfNeeded());
            if (launchedUpdate)
            {
                // Shutdown() touches WPF's application lifecycle and has to run on the UI
                // thread; MessageBox.Show inside the checkers themselves is fine to call from
                // this background thread as-is (it doesn't require the STA/dispatcher thread
                // the way other WPF UI operations do).
                Dispatcher.Invoke(Shutdown);
            }
        });
#endif
    }
}

