using Windows.Security.Credentials;

namespace ReAI.Import;

internal static class Credentials
{
    private const string Resource = "ReAI Import";
    private const string User = "Company connection";
    public static string? Read()
    {
        var vault = new PasswordVault();
        var credential = vault.RetrieveAll().FirstOrDefault(c => c.Resource == Resource && c.UserName == User);
        if (credential == null) return null;
        credential.RetrievePassword(); return credential.Password;
    }
    public static void Save(string token)
    {
        Clear(); new PasswordVault().Add(new PasswordCredential(Resource, User, token));
    }
    public static void Clear()
    {
        var vault = new PasswordVault();
        foreach (var credential in vault.RetrieveAll().Where(c => c.Resource == Resource && c.UserName == User)) vault.Remove(credential);
    }
}
