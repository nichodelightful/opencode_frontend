using System.Windows;

namespace AIChatBox.Launcher;

public partial class ApiKeyDialog : Window
{
    private readonly ApiKeyStore _store;

    internal ApiKeyDialog(ApiKeyStore store)
    {
        InitializeComponent();
        _store = store;
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            _store.Save(ApiKeyInput.Password);
            DialogResult = true;
        }
        catch (Exception exception)
        {
            ErrorText.Text = exception.Message;
        }
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
    }
}
