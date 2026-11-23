using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

internal sealed record RegistrationInput(
    string Username, string FirstName, string LastName, string? MiddleName, string Password, string Email,
    bool Corporate, string? OrganizationType, string? OrganizationName, RegistrationInput.Administrator[] Administrators,
    string? SecondaryEmail, string About, string? GitHub, string? Telegram, string Theme,
    byte[]? Avatar, string? AvatarMime, bool Marketing)
{
    internal sealed record Administrator(string Role, string Identifier);

    internal static (RegistrationInput? Input, string? Error) Read(JsonElement input)
    {
        var type = Field(input, "account_type");
        var corporate = Text(type) == "corporate";
        var username = Text(Field(input, "username"));
        var error = ValidateUsername(Field(input, "username"), username);
        if (error is not null) return Invalid(error);

        var first = Field(input, "first_name");
        var last = Field(input, "last_name");
        var middle = Field(input, "middle_name");
        if (!ValidName(first, !corporate)) return Invalid("Имя должно содержать только кириллические или латинские буквы и тире.");
        if (!ValidName(last, !corporate)) return Invalid("Фамилия должна содержать только кириллические или латинские буквы и тире.");
        if (!ValidName(middle, false)) return Invalid("Отчество должно содержать только кириллические или латинские буквы и тире.");

        var password = Text(Field(input, "password"));
        if (password is null || !LegacyPasswordVerifier.MeetsRegistrationPolicy(password))
            return Invalid("Пароль должен содержать 8–128 символов, строчную и заглавную латинские буквы, цифру и специальный символ; пробелы не допускаются.");
        if (Text(Field(input, "confirm_password")) != password) return Invalid("Пароли должны совпадать.");

        var address = Text(Field(input, "email"));
        if (address is null || !LoginEmailEndpoint.IsEmailAddress(address)) return Invalid("Проверьте формат e-mail.");
        var email = address.ToLowerInvariant();
        if (!Absent(type) && Text(type) is not ("individual" or "corporate")) return Invalid("Invalid account type");

        var organizationType = Field(input, "organization_type");
        var organizationName = Field(input, "organization_name");
        if ((corporate || !EmptyOptionalText(organizationType)) && Text(organizationType) is not ("ИП" or "ООО" or "ПАО" or "НПАО" or "НКО" or "ГУП" or "МУП" or "Другое"))
            return Invalid("Выберите тип организации из списка.");
        var name = Text(organizationName);
        if ((corporate || !EmptyOptionalText(organizationName))
            && (name is null || Length(name) > 160 || !Regex.IsMatch(name, """\A(?=.*[A-Za-zА-Яа-яЁё])[A-Za-zА-Яа-яЁё0-9 .,"'«»‘’\-–—‐‑№&]+\z""")))
            return Invalid("Введите корректное название организации.");

        var (administrators, adminsError) = ReadAdministrators(Field(input, "administrators"), corporate);
        if (adminsError is not null) return Invalid(adminsError);

        var secondary = Field(input, "secondary_email");
        var about = Field(input, "about");
        var github = Field(input, "github_url");
        var telegram = Field(input, "telegram_url");
        var theme = Field(input, "preferred_theme");
        var avatar = Field(input, "avatar");
        error = TextError(secondary, "secondary email", 254)
            ?? TextError(about, "about", 1200)
            ?? TextError(github, "github url", 255)
            ?? LinkError(github, @"\Ahttps://github\.com/[A-Za-z0-9-]{1,39}/?\z", "Укажите ссылку вида https://github.com/username.")
            ?? TextError(telegram, "telegram url", 255)
            ?? LinkError(telegram, @"\Ahttps://t\.me/[A-Za-z0-9_]{5,32}/?\z", "Укажите ссылку вида https://t.me/username.")
            ?? TextError(theme, "preferred theme")
            ?? TextError(avatar, "avatar");
        if (error is not null) return Invalid(error);
        var themeText = Text(theme);
        if (!EmptyOptionalText(theme) && themeText is not ("light" or "dark" or "system"))
            return Invalid("The selected preferred theme is invalid.");
        if (!Accepted(Field(input, "personal_data_consent")))
            return Invalid("Для регистрации необходимо согласиться на обработку персональных данных.");
        var marketing = Field(input, "marketing_consent");
        var boolMarketing = Boolean(marketing);
        if (marketing.ValueKind != JsonValueKind.Undefined && boolMarketing is null)
            return Invalid("The marketing consent field must be true or false.");

        var secondaryText = Trim(Text(secondary) ?? "").ToLowerInvariant();
        if (secondaryText != "" && (!LoginEmailEndpoint.IsEmailAddress(secondaryText) || secondaryText == email))
            return Invalid("Проверьте дополнительную почту: она должна отличаться от основной.");
        var (bytes, mime, avatarError) = Absent(avatar) ? (null, null, null) : ProfileAvatar.Parse(Text(avatar));
        if (avatarError is not null) return Invalid(avatarError);

        return (new(username!, Text(first) ?? "", Text(last) ?? "", Text(middle), password, email, corporate,
            Text(organizationType), name, administrators!, NullIfEmpty(secondaryText), Trim(Text(about) ?? ""),
            NullIfEmpty(Trim(Text(github) ?? "")), NullIfEmpty(Trim(Text(telegram) ?? "")), themeText ?? "system",
            bytes, mime, boolMarketing == true), null);
    }

    private static (Administrator[]?, string?) ReadAdministrators(JsonElement field, bool corporate)
    {
        var empty = Absent(field) || Text(field) is { } text && Trim(text) == ""
            || field.ValueKind == JsonValueKind.Array && field.GetArrayLength() == 0
            || field.ValueKind == JsonValueKind.Object && !field.EnumerateObject().Any();
        if (corporate && empty) return (null, "The administrators field is required when account type is corporate.");
        if (!corporate && !empty) return (null, "The administrators field is prohibited when account type is individual.");
        if (!corporate && EmptyOptionalText(field))
            return ([], null);
        if (field.ValueKind is not (JsonValueKind.Array or JsonValueKind.Object)) return (null, "The administrators field must be an array.");
        var items = field.ValueKind == JsonValueKind.Array
            ? field.EnumerateArray().Select((item, index) => (index.ToString(System.Globalization.CultureInfo.InvariantCulture), item)).ToArray()
            : field.EnumerateObject().Select(item => (item.Name, item.Value)).ToArray();
        if (items.Length < 1) return (null, "The administrators field must have at least 1 items.");
        if (items.Length > 5) return (null, "The administrators field must not have more than 5 items.");
        foreach (var (index, item) in items)
        {
            var raw = Field(item, "role");
            var role = Text(raw);
            if (EmptyOptionalText(raw)) return (null, $"The administrators.{index}.role field is required.");
            if (role is null) return (null, $"The administrators.{index}.role field must be a string.");
            if (role is not ("owner" or "admin" or "manager" or "support"))
                return (null, $"The selected administrators.{index}.role is invalid.");
        }
        var result = new List<Administrator>(items.Length);
        foreach (var (index, item) in items)
        {
            var raw = Field(item, "identifier");
            var identifier = Text(raw);
            if (EmptyOptionalText(raw)) return (null, $"The administrators.{index}.identifier field is required.");
            if (identifier is null) return (null, $"The administrators.{index}.identifier field must be a string.");
            if (Length(identifier) > 254) return (null, $"The administrators.{index}.identifier field must not be greater than 254 characters.");
            result.Add(new(Text(Field(item, "role"))!, identifier));
        }
        if (items[0].Item1 != "0")
        {
            // The PHP contract requires the owner in row with key zero.
            var ownerRow = Array.FindIndex(items, item => item.Item1 == "0");
            if (ownerRow < 0) return (null, "Первая строка должна содержать единственного владельца аккаунта.");
            (result[0], result[ownerRow]) = (result[ownerRow], result[0]);
        }
        return (result.ToArray(), null);
    }

    private static string? ValidateUsername(JsonElement field, string? value)
    {
        if (EmptyOptionalText(field)) return "The username field is required.";
        if (value is null) return "The username field must be a string.";
        if (!value.StartsWith('@')) return "Логин должен начинаться с символа @.";
        if (value.Any(c => !char.IsAscii(c))) return "Используйте только латинские буквы.";
        if (value.Length < 2 || !char.IsAsciiLetter(value[1])) return "После @ логин должен начинаться с латинской буквы.";
        if (value.Skip(2).Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_')))
            return "После @ разрешены латинские буквы, цифры, дефис и подчёркивание.";
        if (value.Length < 4) return "Логин вместе с @ должен содержать не менее 4 символов.";
        return value.Length > 24 ? "Логин вместе с @ должен содержать не более 24 символов." : null;
    }

    private static bool ValidName(JsonElement field, bool required) => EmptyOptionalText(field) ? !required
        : Text(field) is { } value && Regex.IsMatch(value, @"\A(?=.*[A-Za-zА-Яа-яЁё])[A-Za-zА-Яа-яЁё\-–—]{1,60}\z");

    private static string? TextError(JsonElement field, string name, int max = int.MaxValue)
    {
        if (Absent(field)) return null;
        if (Text(field) is not { } value) return $"The {name} field must be a string.";
        return Length(value) > max ? $"The {name} field must not be greater than {max} characters." : null;
    }

    private static string? LinkError(JsonElement field, string pattern, string error) =>
        Text(field) is { } value && Trim(value) != "" && !Regex.IsMatch(value, pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant) ? error : null;

    private static bool Accepted(JsonElement field) => field.ValueKind == JsonValueKind.True
        || field.ValueKind == JsonValueKind.Number && field.GetRawText() == "1"
        || Text(field) is "yes" or "on" or "1" or "true";

    private static bool? Boolean(JsonElement field) => field.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Number when field.GetRawText() is "1" or "0" => field.GetRawText() == "1",
        JsonValueKind.String when Text(field) is "1" or "0" => Text(field) == "1",
        _ => null,
    };

    private static (RegistrationInput?, string) Invalid(string message) => (null, message);
    private static int Length(string value) => value.EnumerateRunes().Count();
    private static string? NullIfEmpty(string value) => value.Length == 0 ? null : value;
    private static string Trim(string value) => value.Trim(' ', '\t', '\n', '\r', '\v', '\0');
    private static string? Text(JsonElement field) => field.ValueKind == JsonValueKind.String ? field.GetString() : null;
    private static bool Absent(JsonElement field) => field.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null;
    private static bool EmptyOptionalText(JsonElement field) => Absent(field) || Text(field) is { } value && Trim(value) == "";
    private static JsonElement Field(JsonElement input, string name) =>
        input.ValueKind == JsonValueKind.Object && input.TryGetProperty(name, out var field) ? field : default;
}
