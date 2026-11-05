import React, { useEffect, useRef, useState } from 'react';
import { sendAuthRequest } from '../api.js';
import { AuthHeader, AuthLayout, PasswordField, useCsrfToken } from './AuthCommon.jsx';

export function LoginPage() {
  const { csrfToken, connectionError } = useCsrfToken();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [accountChoices, setAccountChoices] = useState([]);
  const [loginAccountType, setLoginAccountType] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [message, setMessage] = useState('');
  const [loginInvalid, setLoginInvalid] = useState({ username: false, password: false });
  const [busy, setBusy] = useState(false);
  const navigationApprovedRef = useRef(false);

  useEffect(() => {
    if (!username && !password) return undefined;
    const warnBeforeUnload = (event) => {
      if (navigationApprovedRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [username, password]);

  useEffect(() => {
    if (!csrfToken || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
      setAccountChoices([]);
      setLoginAccountType('');
      return undefined;
    }

    let current = true;
    const timer = window.setTimeout(() => {
      sendAuthRequest('check_login_email', { email: username }, csrfToken)
        .then((result) => {
          if (!current) return;
          const choices = Array.isArray(result.account_choices) ? result.account_choices : [];
          setAccountChoices(choices);
          setLoginAccountType('');
        })
        .catch(() => {});
    }, 300);

    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [username, csrfToken]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!username || !password) {
      setLoginInvalid({ username: !username, password: !password });
      setMessage(!username ? 'Введите логин.' : 'Введите пароль.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const payload = { username, password };
      if (loginAccountType) payload.account_type = loginAccountType;
      const result = await sendAuthRequest('login', payload, csrfToken);
      if (Array.isArray(result.account_choices)) {
        setAccountChoices(result.account_choices);
        setLoginAccountType('');
        setBusy(false);
        return;
      }
      navigationApprovedRef.current = true;
      window.location.assign(result.corporate_account ? '/pages/organization-root.html' : '/pages/workspace.html');
    } catch (error) {
      setMessage(error.message);
      setLoginInvalid({ username: true, password: true });
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <AuthHeader eyebrow="ВАШЕ ПРОСТРАНСТВО ДЛЯ ДЕЛ" title="С возвращением">
        Войдите, чтобы продолжить работу со своими задачами.
      </AuthHeader>
      <form className="auth-form" noValidate onSubmit={handleSubmit}>
        <div className="login-credentials">
          <div className="auth-form__field">
            <label htmlFor="username">Логин или email</label>
            <input id="username" name="username" autoComplete="username" placeholder="Ваш логин или email" value={username} aria-invalid={loginInvalid.username} onChange={(event) => { setUsername(event.target.value); setAccountChoices([]); setLoginAccountType(''); setLoginInvalid((current) => ({ ...current, username: false })); setMessage(''); }} required />
          </div>
          <PasswordField
            id="password"
            label="Пароль"
            value={password}
            onChange={(event) => { setPassword(event.target.value); setLoginInvalid((current) => ({ ...current, password: false })); setMessage(''); }}
            invalid={loginInvalid.password}
            visible={passwordVisible}
            onToggle={() => setPasswordVisible((current) => !current)}
            autoComplete="current-password"
            placeholder="Ваш пароль"
          />
          {accountChoices.length > 1 && <div className="login-account-choice">
            <span className="login-account-choice__label">Войти в</span>
            <div className="login-account-choice__slider" role="group" aria-label="Выберите аккаунт для входа">
              <button type="button" className={loginAccountType === 'individual' ? 'is-selected' : ''} aria-pressed={loginAccountType === 'individual'} onClick={() => setLoginAccountType('individual')}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="10" cy="6" r="3" /><path d="M4 17v-1a6 6 0 0 1 12 0v1" /></svg>
                Личный
              </button>
              <button type="button" className={loginAccountType === 'corporate' ? 'is-selected' : ''} aria-pressed={loginAccountType === 'corporate'} onClick={() => setLoginAccountType('corporate')}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="14" height="14" rx="2" /><path d="M7 7h1m4 0h1M7 10h1m4 0h1M8 17v-3h4v3" /></svg>
                Корпоративный
              </button>
            </div>
          </div>}
        </div>
        <a className="auth-form__forgot" href="/pages/forgot-password.html">Забыли пароль?</a>
        {(message || connectionError) && <p className="auth-form__status" role="alert">{message || connectionError}</p>}
        <button className="auth-form__submit" type="submit" disabled={!csrfToken || busy || (accountChoices.length > 1 && !loginAccountType)}>{busy ? 'Входим…' : 'Войти'}</button>
      </form>
      <p className="auth-card__footer">Нет аккаунта? <a href="/pages/register.html">Зарегистрироваться</a></p>
    </AuthLayout>
  );
}
