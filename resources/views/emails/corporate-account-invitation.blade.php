@php
    $roleNames = [
        'owner' => 'Владелец',
        'admin' => 'Администратор',
        'manager' => 'Менеджер',
        'support' => 'Поддержка',
    ];
    $displayRole = $roleNames[$role] ?? $role;
@endphp
<!doctype html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>Приглашение в To Do Inn!</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#172b49;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f1f5fb;padding:36px 14px;">
        <tr>
            <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:580px;background-color:#ffffff;border:1px solid #e1e8f2;border-radius:18px;overflow:hidden;">
                    <tr>
                        <td style="padding:23px 34px;background-color:#ffffff;border-bottom:1px solid #e8edf4;">
                            <img src="{{ $message->embed($logoPath) }}" width="154" alt="To Do Inn!" style="display:block;width:154px;max-width:100%;height:auto;border:0;">
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:34px 34px 12px;">
                            <p style="margin:0 0 10px;color:#3973b2;font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">Приглашение в команду</p>
                            <h1 style="margin:0;color:#172b49;font-size:25px;line-height:1.25;">Вас пригласили в рабочее пространство</h1>
                            <p style="margin:18px 0 0;color:#52647c;font-size:15px;line-height:1.7;">Вы приглашены в корпоративный аккаунт</p>
                            <div style="margin-top:8px;padding:15px 17px;border:1px solid #dce7f5;border-radius:12px;background-color:#f5f8fd;color:#18395f;font-size:18px;font-weight:700;line-height:1.45;">{{ $organizationLabel }}</div>
                            <p style="margin:16px 0 0;color:#52647c;font-size:14px;line-height:1.6;">Ваша роль: <strong style="color:#263c5a;">{{ $displayRole }}</strong></p>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding:24px 34px 18px;">
                            <a href="{{ $invitationUrl }}" style="display:inline-block;padding:14px 25px;border-radius:10px;background-color:#3478d4;color:#ffffff;font-size:15px;font-weight:700;line-height:1.2;text-decoration:none;">Принять приглашение</a>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:0 34px 30px;">
                            <p style="margin:0;color:#6c7b90;font-size:13px;line-height:1.65;">Приглашение действительно 7 дней. Если вы не ожидали это письмо, просто проигнорируйте его.</p>
                            <p style="margin:18px 0 0;padding-top:16px;border-top:1px solid #e8edf4;color:#8290a3;font-size:12px;line-height:1.6;">Если кнопка не работает, скопируйте ссылку в браузер:<br><a href="{{ $invitationUrl }}" style="color:#3478d4;overflow-wrap:anywhere;">{{ $invitationUrl }}</a></p>
                        </td>
                    </tr>
                </table>
                <p style="margin:16px 0 0;color:#8b98a9;font-size:11px;line-height:1.5;">Это автоматическое письмо от To Do Inn!</p>
            </td>
        </tr>
    </table>
</body>
</html>
