using System.Configuration;
using System.Data;
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

#if !DEBUG
        if (UpdateChecker.TryLaunchUpdateIfNeeded())
        {
            Shutdown();
            return;
        }
#endif

        new MainWindow().Show();
    }
}

