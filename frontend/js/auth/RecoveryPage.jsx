import React, { useEffect, useState } from 'react';
import { sendAuthRequest } from '../api.js';
import { AuthHeader, AuthLayout, PasswordField, useCsrfToken } from './AuthCommon.jsx';
import { createSecurePassword } from './helpers.js';
import keyIcon from './icons/key.svg';

export function RecoveryPage() {
  const { csrfToken, connectionError } = useCsrfToken();
  const [token, setToken] = useState(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
    return /^[a-f0-9]{64}$/.test(value) ? value : '';
  });
  const [step, setStep] = useState(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
    return value ? (/^[a-f0-9]{64}$/.test(value) ? 'reset' : 'invalid') : 'request';
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState(false);
  const [passwordCopyStatus, setPasswordCopyStatus] = useState('');
  const [isGeneratingPassword, setIsGeneratingPassword] = useState(false);

  useEffect(() => {
    if (step !== 'complete') return undefined;
    const timer = window.setTimeout(() => window.location.replace('/'), 30_000);
    return () => window.clearTimeout(timer);
  }, [step]);

  useEffect(() => {
    if (!window.location.hash) return;
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`);
  }, []);

  async function requestReset(event) {
    event.preventDefault();
    if (!csrfToken || busy) return;
    setBusy(true);
    setMessage('');
    try {
      await sendAuthRequest('request_password_reset', { email }, csrfToken);
      setStep('sent');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveNewPassword(event) {
    event.preventDefault();
    if (!csrfToken || busy) return;
    setBusy(true);
    setMessage('');
    try {
      await sendAuthRequest('reset_password', {
        token,
        password,
        confirm_password: confirmation,
      }, csrfToken);
      setToken('');
      setPassword('');
      setConfirmation('');
      setStep('complete');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function generateRecoveryPassword() {
    setIsGeneratingPassword(true);
    setPasswordCopyStatus('');
    const generated = createSecurePassword();
    setPassword(generated);
    setConfirmation(generated);
    try {
      await window.navigator.clipboard.writeText(generated);
      setPasswordCopyStatus('Пароль сгенерирован и скопирован. Сохраните его в надёжном месте.');
    } catch {
      setPasswordCopyStatus('Пароль сгенерирован. Сохраните его в надёжном месте.');
    } finally {
      setIsGeneratingPassword(false);
    }
  }

  if (step === 'complete') {
    return (
      <AuthLayout success finale>
        <div className="registration-finale is-welcome" aria-live="polite">
          <div className="registration-finale__welcome">
            <span className="registration-finale__celebration" aria-hidden="true">🔑</span>
            <p className="registration-finale__eyebrow">ДОСТУП ВОССТАНОВЛЕН</p>
            <h1>Ваш пароль успешно изменён!</h1>
            <p className="registration-finale__description">Теперь войдите с новым паролем. Через 30 секунд мы автоматически вернём вас ко входу.</p>
            <a className="registration-finale__button" href="/">
              Вернуться ко входу
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
            </a>
          </div>
        </div>
      </AuthLayout>
    );
  }

  const title = step === 'reset' ? 'Новый пароль'
    : step === 'complete' ? 'Пароль изменён'
      : step === 'sent' ? 'Проверьте почту' : 'Забыли пароль?';

  return (
    <AuthLayout>
      <AuthHeader eyebrow="ВОССТАНОВЛЕНИЕ ДОСТУПА" title={title}>
        {step === 'reset' && 'Придумайте новый пароль для личного аккаунта.'}
        {step === 'sent' && 'Если личный аккаунт с таким адресом существует, на него отправлена ссылка для восстановления.'}
        {step === 'invalid' && 'Ссылка восстановления повреждена. Запросите новую.'}
        {step === 'request' && 'Укажите e-mail, который вы использовали при регистрации.'}
      </AuthHeader>
      {connectionError && <p className="auth-form__submit-warning" role="alert">{connectionError}</p>}
      {step === 'request' && <form className="auth-form" onSubmit={requestReset}>
        <div className="auth-form__field">
          <label htmlFor="recovery-email">Электронная почта</label>
          <input id="recovery-email" type="email" autoComplete="email" placeholder="name@example.com" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} required />
        </div>
        {message && <p className="auth-form__submit-warning" role="alert">{message}</p>}
        <button className="auth-form__submit" type="submit" disabled={!csrfToken || busy}>{busy ? 'Отправляем…' : 'Отправить ссылку'}</button>
      </form>}
      {step !== 'complete' && <a className="auth-form__forgot recovery-no-email" href="#" aria-disabled="true" title="Связь с поддержкой пока не настроена" onClick={(event) => event.preventDefault()}>Нет доступа к почте?</a>}
      {step === 'reset' && <form className="auth-form" onSubmit={saveNewPassword}>
        <div className="auth-form__field">
          <PasswordField id="recovery-password" label="Новый пароль" value={password} onChange={(event) => setPassword(event.target.value)} visible={visiblePasswords} onToggle={() => setVisiblePasswords((current) => !current)} autoComplete="new-password" placeholder="Придумайте пароль" hint="От 8 символов: строчная и заглавная латинские буквы, цифра и символ." />
        </div>
        <button className="register-password-generate" type="button" onClick={generateRecoveryPassword} disabled={isGeneratingPassword}>
          {isGeneratingPassword ? <span className="register-password-generate__loading" aria-hidden="true"><img src={keyIcon} alt="" /><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" /></svg></span> : <img src={keyIcon} alt="" aria-hidden="true" />}
          <span>{isGeneratingPassword ? 'Генерируем пароль…' : 'Сгенерировать безопасный пароль'}</span>
        </button>
        {passwordCopyStatus && <p className="register-password-copy-status" role="status">{passwordCopyStatus}</p>}
        {password && <div className="register-password-confirmation">
          <PasswordField id="recovery-confirm-password" label="Повторите новый пароль" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} visible={visiblePasswords} onToggle={() => setVisiblePasswords((current) => !current)} autoComplete="new-password" placeholder="Повторите пароль" />
        </div>}
        {message && <p className="auth-form__submit-warning" role="alert">{message}</p>}
        <button className="auth-form__submit" type="submit" disabled={!csrfToken || busy || !password || !confirmation}>{busy ? 'Сохраняем…' : 'Сохранить новый пароль'}</button>
      </form>}
      {step === 'sent' && <p className="auth-form__status" role="status">Проверьте папки «Входящие» и «Спам». Ссылка действует 30 минут.</p>}
      {step === 'complete' && <p className="auth-form__status" role="status">Пароль успешно изменён.</p>}
      {step === 'invalid' && <p className="auth-form__status" role="status">Откройте новую ссылку из письма или запросите восстановление ещё раз.</p>}
      <p className="auth-card__footer"><a href="/">Вернуться ко входу</a></p>
    </AuthLayout>
  );
}
