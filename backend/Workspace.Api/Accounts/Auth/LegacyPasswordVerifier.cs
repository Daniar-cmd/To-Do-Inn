using System.Globalization;
using System.Text.RegularExpressions;
using Isopoh.Cryptography.Argon2;

namespace Workspace.Api.Accounts.Auth;

internal static partial class LegacyPasswordVerifier
{
    // Preview bounds cover the app's known PHP settings. Inventory stored costs before cutover.
    private const int MaxBcryptCost = 16;
    private const int MaxArgonMemoryKiB = 262_144;
    private const int MaxArgonPasses = 10;
    private const int MaxArgonLanes = 8;

    internal static string Hash(string password) => Argon2.Hash(password, timeCost: 4, memoryCost: 65_536,
        parallelism: 1, type: Argon2Type.HybridAddressing, hashLength: 32);

    internal static bool MeetsRegistrationPolicy(string? password) =>
        password is { Length: >= 8 and <= 128 } && password.All(c => c is >= '!' and <= '~')
        && password.Any(char.IsAsciiLetterLower) && password.Any(char.IsAsciiLetterUpper)
        && password.Any(char.IsAsciiDigit) && password.Any(c => !char.IsAsciiLetterOrDigit(c));

    internal static bool Verify(string password, string? hash)
    {
        if (string.IsNullOrEmpty(hash) || hash.Length > 255) return false;

        try
        {
            if (hash.StartsWith("$argon2id$", StringComparison.Ordinal))
                return HasSupportedArgonParameters(hash) && Argon2.Verify(hash, password, threads: 1);

            var bcrypt = BcryptHash().Match(hash);
            if (!bcrypt.Success || !Parse(bcrypt.Groups["cost"].Value, out var cost) || cost is < 4 or > MaxBcryptCost)
                return false;

            // PHP's legacy bcrypt verifier treats the first NUL as the end of the password.
            var terminator = password.IndexOf('\0');
            var legacyPassword = terminator < 0 ? password : password[..terminator];
            return BCrypt.Net.BCrypt.Verify(legacyPassword, hash);
        }
        catch (Exception exception) when (exception is ArgumentException or FormatException or BCrypt.Net.SaltParseException)
        {
            return false;
        }
    }

    private static bool HasSupportedArgonParameters(string hash)
    {
        var match = ArgonHash().Match(hash);
        return match.Success
            && Parse(match.Groups["lanes"].Value, out var lanes) && lanes is >= 1 and <= MaxArgonLanes
            && Parse(match.Groups["passes"].Value, out var passes) && passes is >= 1 and <= MaxArgonPasses
            && Parse(match.Groups["memory"].Value, out var memory) && memory >= 8 * lanes && memory <= MaxArgonMemoryKiB;
    }

    private static bool Parse(string value, out int number) =>
        int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out number);

    [GeneratedRegex(@"\A\$2[aby]\$(?<cost>[0-9]{2})\$[./A-Za-z0-9]{53}\z")]
    private static partial Regex BcryptHash();

    [GeneratedRegex(@"\A\$argon2id\$v=19\$m=(?<memory>[0-9]+),t=(?<passes>[0-9]+),p=(?<lanes>[0-9]+)\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}\z")]
    private static partial Regex ArgonHash();
}
