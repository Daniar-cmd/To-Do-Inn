<!doctype html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>Восстановление пароля — To Do Inn!</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5fa;font-family:Arial,Helvetica,sans-serif;color:#25364b;-webkit-text-size-adjust:100%;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f1f5fa;">
        <tr>
            <td align="center" style="padding:36px 16px;">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
                    <tr>
                        <td style="padding:0 0 20px;">
                            <img src="{{ $message->embed($logoPath) }}" width="154" alt="To Do Inn!" style="display:block;width:154px;max-width:100%;height:auto;border:0;">
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:38px 40px 34px;border:1px solid #e0e7f0;border-radius:16px;background-color:#ffffff;">
                            <p style="margin:0 0 10px;color:#3478d4;font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;">Восстановление доступа</p>
                            <h1 style="margin:0 0 14px;color:#18334f;font-size:26px;line-height:1.3;font-weight:700;">Задайте новый пароль</h1>
                            <p style="margin:0 0 26px;color:#617187;font-size:15px;line-height:1.65;">Здравствуйте{{ $recipientName !== '' ? ' '.$recipientName : '' }}! Вы запросили восстановление пароля для своего аккаунта To Do Inn!.</p>
                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;">
                                <tr>
                                    <td align="center" style="border-radius:9px;background-color:#2555a0;">
                                        <a href="{{ $resetUrl }}" style="display:inline-block;padding:14px 22px;border-radius:9px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;">Восстановить пароль</a>
                                    </td>
                                </tr>
                            </table>
                            <p style="margin:0 0 24px;color:#617187;font-size:13px;line-height:1.6;">Ссылка действует <strong style="color:#25364b;">30 минут</strong> и может быть использована только один раз.</p>
                            <p style="margin:0 0 10px;color:#617187;font-size:12px;line-height:1.6;">Если кнопка не работает, скопируйте ссылку в адресную строку браузера:</p>
                            <p style="margin:0 0 24px;overflow-wrap:anywhere;color:#3478d4;font-size:12px;line-height:1.6;">{{ $resetUrl }}</p>
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
                                <tr>
                                    <td style="padding:14px 16px;border-left:3px solid #d8e4f2;background-color:#f7f9fc;color:#617187;font-size:13px;line-height:1.6;">Если вы не запрашивали восстановление, просто проигнорируйте это письмо.</td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding:20px 12px 0;color:#8290a2;font-size:12px;line-height:1.6;">Это автоматическое письмо от To Do Inn!. Пожалуйста, не отвечайте на него.</td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
