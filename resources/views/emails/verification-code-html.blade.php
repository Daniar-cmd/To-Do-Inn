<!doctype html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>Код подтверждения — To Do Inn!</title>
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
                            <p style="margin:0 0 10px;color:#3478d4;font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;">Подтверждение почты</p>
                            <h1 style="margin:0 0 14px;color:#18334f;font-size:26px;line-height:1.3;font-weight:700;">Ваш код регистрации</h1>
                            <p style="margin:0 0 26px;color:#617187;font-size:15px;line-height:1.65;">Введите этот код на странице регистрации, чтобы подтвердить адрес электронной почты.</p>
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0 0 22px;">
                                <tr>
                                    <td align="center" style="padding:19px 12px;border:1px solid #d9e7f8;border-radius:12px;background-color:#f4f8fe;color:#18334f;font-family:Arial,Helvetica,sans-serif;font-size:34px;font-weight:bold;letter-spacing:9px;line-height:1.2;">
                                        {{ $code }}
                                    </td>
                                </tr>
                            </table>
                            <p style="margin:0 0 24px;color:#617187;font-size:13px;line-height:1.6;">Код действителен <strong style="color:#25364b;">10 минут</strong>.</p>
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;">
                                <tr>
                                    <td style="padding:14px 16px;border-left:3px solid #d8e4f2;background-color:#f7f9fc;color:#617187;font-size:13px;line-height:1.6;">
                                        Если вы не запрашивали регистрацию, просто проигнорируйте это письмо. Никому не сообщайте код.
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td align="center" style="padding:20px 12px 0;color:#8290a2;font-size:12px;line-height:1.6;">
                            Это автоматическое письмо от To Do Inn!. Пожалуйста, не отвечайте на него.
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
