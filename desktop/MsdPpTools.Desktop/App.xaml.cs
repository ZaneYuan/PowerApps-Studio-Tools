using System.Configuration;
using System.Data;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;
using MsdPpTools.Desktop.Diagnostics;
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

        // No handler existed before this — any unhandled exception anywhere (including one a
        // buggy third-party IME's injected TSF hooks trigger by calling back into our code at a
        // moment it doesn't expect, a real crash seen in practice: Exception Code 0xe0434352 —
        // the CLR's own "unhandled managed exception" marker, not a native access violation, so
        // catchable in principle — with Baidu's IME DLLs loaded in-process at the time) took the
        // entire process down with it. We can't fix a third-party binary's own bug, but we don't
        // have to let it kill an app that has unsaved SQL/data-copy state in open tabs either.
        // DispatcherUnhandledException covers the UI thread (where IME/input callbacks land) and
        // is the one case actually recoverable — Handled = true keeps the app running instead of
        // dying. AppDomain.UnhandledException and TaskScheduler.UnobservedTaskException can't
        // stop what's already happening by the time they fire, but still get logged so a future
        // crash leaves a trace in our own log instead of only in a vendor crash-reporter's temp
        // file that vanishes the moment its dialog is dismissed.
        DispatcherUnhandledException += (_, args) =>
        {
            CrashLog.Write("DispatcherUnhandledException", args.Exception);
            MessageBox.Show(
                $"程序遇到了一个未预期的错误，已记录到日志（%AppData%\\MsdPpTools\\crash.log），将尝试继续运行：\n\n{args.Exception.Message}",
                "发生错误",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
            args.Handled = true;
        };
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
        {
            if (args.ExceptionObject is Exception ex)
            {
                CrashLog.Write("AppDomain.UnhandledException", ex);
            }
        };
        TaskScheduler.UnobservedTaskException += (_, args) =>
        {
            CrashLog.Write("TaskScheduler.UnobservedTaskException", args.Exception);
            args.SetObserved();
        };

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

