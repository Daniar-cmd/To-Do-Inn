@php
    $roleNames = [
        'owner' => 'Владелец',
        'admin' => 'Администратор',
        'manager' => 'Менеджер',
        'support' => 'Поддержка',
    ];
    $displayRole = $roleNames[$role] ?? $role;
@endphp
Здравствуйте{{ $recipientName !== '' ? ' '.$recipientName : '' }}!

Вас пригласили в корпоративный аккаунт {{ $organizationLabel }}.
Ваша роль: {{ $displayRole }}.

Принять приглашение: {{ $invitationUrl }}

Приглашение действительно 7 дней. Если вы не ожидали это письмо, проигнорируйте его.
