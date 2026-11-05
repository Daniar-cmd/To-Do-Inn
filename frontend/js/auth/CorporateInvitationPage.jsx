import React, { useState } from 'react';
import { sendAuthRequest } from '../api.js';
import { AuthHeader, AuthLayout, useCsrfToken } from './AuthCommon.jsx';

export function CorporateInvitationPage() {
  const { csrfToken, connectionError } = useCsrfToken();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [accepted, setAccepted] = useState(null);
  const token = new URLSearchParams(window.location.search).get('token') || '';

  async function acceptInvitation() {
    if (!csrfToken || busy || !token) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await sendAuthRequest('accept_corporate_invitation', { token }, csrfToken);
      setAccepted(result);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <AuthHeader eyebrow="КОРПОРАТИВНЫЙ АККАУНТ" title={accepted ? 'Приглашение принято' : 'Приглашение администратора'}>
        {accepted ? 'Роль сохранена за указанным e-mail.' : 'Подтвердите приглашение в корпоративный аккаунт.'}
      </AuthHeader>
      {connectionError && <p className="auth-form__submit-warning" role="alert">{connectionError}</p>}
      {!token && <p className="auth-form__submit-warning" role="alert">В ссылке нет кода приглашения.</p>}
      {message && <p className="auth-form__submit-warning" role="alert">{message}</p>}
      {!accepted && <button className="auth-form__submit" type="button" onClick={acceptInvitation} disabled={!csrfToken || busy || !token}>{busy ? 'Принимаем…' : 'Принять приглашение'}</button>}
      {accepted && <p className="auth-form__status" role="status">{accepted.registered ? 'Приглашение связано с вашим аккаунтом.' : 'Зарегистрируйтесь с приглашённым e-mail, чтобы связать роль с аккаунтом.'}</p>}
      <p className="auth-card__footer"><a href={accepted?.registered ? '/' : '/pages/register.html'}>{accepted?.registered ? 'Перейти ко входу' : 'Зарегистрироваться'}</a></p>
    </AuthLayout>
  );
}
