import React, { useEffect, useRef, useState } from 'react';
import { getSession, sendAuthRequest } from '../api.js';
import { NotificationsMenu } from '../NotificationsMenu.jsx';
import { CustomSelect } from './CustomSelect.jsx';
import personalAccountIcon from './icons/account-personal.svg';
import corporateAccountIcon from './icons/account-corporate.svg';
import keyIcon from './icons/key.svg';
import brandLogo from '../../../logos/ToDo-Inn-logo.svg';

function usernameValidationError(username) {
  if (!username) return 'Введите логин.';
  if (/[^\x00-\x7F]/.test(username)) return 'Используйте только латинские буквы.';
  if (!/^[A-Za-z]/.test(username)) return 'Логин должен начинаться с латинской буквы.';
  if (/[^A-Za-z0-9_-]/.test(username)) return 'Разрешены латинские буквы, цифры, дефис и подчёркивание.';
  if (username.length < 3) return 'Логин вместе с @ должен содержать не менее 4 символов.';
  if (username.length > 23) return 'Логин вместе с @ должен содержать не более 24 символов.';
  return '';
}

function Brand() {
  return (
    <div className="auth-card__brand">
      <img src={brandLogo} alt="To Do Inn!" />
    </div>
  );
}

function AuthLayout({ children, wide = false, corporateAdmin = false, success = false, finale = false }) {
  const [enhancedBackground, setEnhancedBackground] = useState(false);
  const [backgroundMotionAllowed, setBackgroundMotionAllowed] = useState(false);
  const pointerFrame = useRef(0);
  const className = ['auth-card', wide && 'auth-card--wide', corporateAdmin && 'auth-card--corporate-admin', success && 'auth-card--success']
    .filter(Boolean)
    .join(' ');

  useEffect(() => {
    const memoryGiB = navigator.deviceMemory;
    const desktopWithHover = window.matchMedia('(min-width: 901px) and (hover: hover) and (pointer: fine)').matches;
    const motionAllowed = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const enoughMemory = typeof memoryGiB !== 'number' || memoryGiB >= 7.5;
    setEnhancedBackground(desktopWithHover && enoughMemory && motionAllowed);
    setBackgroundMotionAllowed(motionAllowed);
    return () => {
      if (pointerFrame.current) window.cancelAnimationFrame(pointerFrame.current);
    };
  }, []);

  return (
    <main
      className={`auth-page${success ? ' auth-page--success' : ''}${enhancedBackground ? finale ? ' auth-page--enhanced' : ' auth-page--interactive' : ''}${finale && enhancedBackground && backgroundMotionAllowed ? ' auth-page--success-motion' : ''}`}
      onPointerMove={(event) => {
        if (!enhancedBackground || !backgroundMotionAllowed || finale || event.pointerType !== 'mouse') return;
        if (event.target instanceof Element && event.target.closest('.auth-card')) {
          if (pointerFrame.current) window.cancelAnimationFrame(pointerFrame.current);
          pointerFrame.current = 0;
          return;
        }
        if (pointerFrame.current) return;
        const page = event.currentTarget;
        const clientX = event.clientX;
        const clientY = event.clientY;
        pointerFrame.current = window.requestAnimationFrame(() => {
          const bounds = page.getBoundingClientRect();
          const x = Math.max(0, Math.min(100, ((clientX - bounds.left) / bounds.width) * 100));
          const y = Math.max(0, Math.min(100, ((clientY - bounds.top) / bounds.height) * 100));
          page.style.setProperty('--pointer-x', `${x}%`);
          page.style.setProperty('--pointer-y', `${y}%`);
          pointerFrame.current = 0;
        });
      }}
      onPointerLeave={(event) => {
        if (pointerFrame.current) window.cancelAnimationFrame(pointerFrame.current);
        pointerFrame.current = 0;
        event.currentTarget.style.setProperty('--pointer-x', '50%');
        event.currentTarget.style.setProperty('--pointer-y', '38%');
      }}
    >
      <section className={className}>
        <Brand />
        {children}
      </section>
    </main>
  );
}

function AuthHeader({ eyebrow, title, children, progress }) {
  return (
    <header className="auth-card__header">
      <div className="auth-card__header-top">
        <p className="auth-card__eyebrow">{eyebrow}</p>
        {progress && <span className="auth-card__progress">{progress}</span>}
      </div>
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </header>
  );
}

function createSecurePassword() {
  const groups = ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789', '!#$%&()*+,-./:;=?@[]^_{|}~'];
  const all = groups.join('');
  const randomIndex = (limit) => {
    const values = new Uint32Array(1);
    const ceiling = Math.floor(0x100000000 / limit) * limit;
    do { window.crypto.getRandomValues(values); } while (values[0] >= ceiling);
    return values[0] % limit;
  };
  const chars = groups.map((group) => group[randomIndex(group.length)]);
  while (chars.length < 16) chars.push(all[randomIndex(all.length)]);
  for (let index = chars.length - 1; index > 0; index--) {
    const swapIndex = randomIndex(index + 1);
    [chars[index], chars[swapIndex]] = [chars[swapIndex], chars[index]];
  }
  return chars.join('');
}

function registrationEmailWarning(accounts) {
  if (accounts.includes('individual') && accounts.includes('corporate')) {
    return 'Нельзя зарегистрировать аккаунт: этот e-mail уже занят и личным, и корпоративным профилем. Войдите в существующий аккаунт или восстановите пароль.';
  }
  if (accounts.includes('individual')) {
    return 'У этого e-mail уже есть личный профиль. Можно подтвердить почту и создать корпоративный аккаунт.';
  }
  if (accounts.includes('corporate')) {
    return 'У этого e-mail уже есть корпоративный профиль. Можно подтвердить почту и создать личный аккаунт.';
  }
  return '';
}

function PasswordField({ id, label, value, onChange, visible, onToggle, autoComplete, placeholder, hint, feedback, invalid, inputRef, onKeyDown, maxLength = 128 }) {
  return (
    <div className="auth-form__field">
      <label htmlFor={id}>{label}</label>
      <div className="password-control">
        <input
          id={id}
          ref={inputRef}
          name={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          maxLength={maxLength}
          aria-invalid={invalid || undefined}
          className={invalid ? 'is-invalid' : undefined}
          required
        />
        <button
          className={`password-control__toggle${visible ? ' is-visible' : ''}`}
          type="button"
          aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
          aria-pressed={visible}
          onClick={onToggle}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
            <path className="password-eye-slash" d="m3 3 18 18" />
          </svg>
        </button>
      </div>
      {hint && <p className="auth-form__hint">{hint}</p>}
      {feedback && <p className={`auth-form__feedback ${invalid ? 'is-invalid' : 'is-valid'}`}>{feedback}</p>}
    </div>
  );
}

function useCsrfToken() {
  const [csrfToken, setCsrfToken] = useState('');
  const [connectionError, setConnectionError] = useState('');

  useEffect(() => {
    getSession()
      .then((data) => setCsrfToken(data.csrf_token))
      .catch(() => setConnectionError('Не удалось подключиться к серверу. Убедитесь, что PHP и база данных запущены.'));
  }, []);

  return { csrfToken, connectionError };
}

function LoginPage() {
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

function RegisterPage() {
  const { csrfToken, connectionError } = useCsrfToken();
  const upgradeMode = new URLSearchParams(window.location.search).get('upgrade') === '1';
  const [form, setForm] = useState({ username: '', firstName: '', lastName: '', middleName: '', organizationType: 'ООО', organizationName: '', password: '', confirmation: '', email: '', accountType: 'individual', avatar: null, about: '', secondaryEmail: '', githubUrl: '', telegramUrl: '', preferredTheme: 'system', personalDataConsent: false, marketingConsent: false });
  const [identityStep, setIdentityStep] = useState('email');
  const [emailCode, setEmailCode] = useState('');
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [localTestCode, setLocalTestCode] = useState('');
  const [sendingEmailCode, setSendingEmailCode] = useState(false);
  const [emailInUse, setEmailInUse] = useState(false);
  const [existingEmailAccounts, setExistingEmailAccounts] = useState([]);
  const [emailAccountNotice, setEmailAccountNotice] = useState('');
  const [resendWait, setResendWait] = useState(0);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const codeInputRef = useRef(null);
  const usernameInputRef = useRef(null);
  const verifyingCodeRef = useRef(false);
  const [visiblePasswords, setVisiblePasswords] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [passwordCopyStatus, setPasswordCopyStatus] = useState('');
  const [isGeneratingPassword, setIsGeneratingPassword] = useState(false);
  const [hasGeneratedPassword, setHasGeneratedPassword] = useState(false);
  const [invalidEmailCode, setInvalidEmailCode] = useState(false);
  const passwordInputRef = useRef(null);
  const confirmationInputRef = useRef(null);
  const [feedback, setFeedback] = useState({});
  const [warning, setWarning] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [checkingRegistrationEmail, setCheckingRegistrationEmail] = useState(false);
  const [administrators, setAdministrators] = useState([{ id: 1, role: 'owner', identifier: '', confirmed: false, editing: false }]);
  const [adminConfirmationId, setAdminConfirmationId] = useState(null);
  const [checkingAdministratorId, setCheckingAdministratorId] = useState(null);
  const nextAdministratorId = useRef(2);
  const navigationApprovedRef = useRef(false);
  const registrationHasInput = Boolean(
    form.email || form.username || form.password || form.confirmation || form.firstName || form.lastName || form.middleName
      || form.organizationName || emailCode || identityStep !== 'email',
  );

  useEffect(() => {
    if (!registrationHasInput) return undefined;
    const warnBeforeUnload = (event) => {
      if (navigationApprovedRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [registrationHasInput]);

  useEffect(() => {
    if (resendWait <= 0) return undefined;
    const timer = window.setTimeout(() => setResendWait((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendWait]);

  useEffect(() => {
    if (identityStep !== 'email' || !csrfToken || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      if (identityStep === 'email' && form.email === '') {
        setExistingEmailAccounts([]);
        setEmailAccountNotice('');
      }
      return undefined;
    }

    let current = true;
    const timer = window.setTimeout(() => {
      sendAuthRequest('check_registration_email', { email: form.email }, csrfToken)
        .then((result) => {
          if (!current) return;
          const accounts = Array.isArray(result.existing_accounts) ? result.existing_accounts : [];
          setExistingEmailAccounts(accounts);
          setEmailAccountNotice(registrationEmailWarning(accounts));
        })
        .catch(() => {});
    }, 350);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [identityStep, csrfToken, form.email]);

  useEffect(() => {
    if (identityStep === 'email-code' && emailCodeSent) codeInputRef.current?.focus();
  }, [identityStep, emailCodeSent]);

  useEffect(() => {
    if (identityStep === 'username' && emailVerified) usernameInputRef.current?.focus();
  }, [identityStep, emailVerified]);

  useEffect(() => {
    if (identityStep === 'password') passwordInputRef.current?.focus();
  }, [identityStep]);

  useEffect(() => {
    if (showConfirmation) confirmationInputRef.current?.focus();
  }, [showConfirmation]);

  useEffect(() => {
    if (identityStep !== 'email-success') return undefined;
    const timer = window.setTimeout(() => setIdentityStep('username'), 2600);
    return () => window.clearTimeout(timer);
  }, [identityStep]);

  useEffect(() => {
    if (identityStep !== 'name' || !emailVerified || !csrfToken) return undefined;
    let current = true;
    setCheckingRegistrationEmail(true);
    setFeedback((previous) => ({ ...previous, email: '' }));
    sendAuthRequest('validate_registration_email', { email: form.email, account_type: form.accountType }, csrfToken)
      .catch((error) => {
        if (current) setFeedback((previous) => ({ ...previous, email: error.message }));
      })
      .finally(() => {
        if (current) setCheckingRegistrationEmail(false);
      });
    return () => { current = false; };
  }, [identityStep, emailVerified, csrfToken, form.email, form.accountType]);

  function validate(next = form) {
    const errors = {};
    const usernameError = usernameValidationError(next.username);
    if (next.username && usernameError) errors.username = usernameError;
    const validName = /^(?=.*[A-Za-zА-Яа-яЁё])[A-Za-zА-Яа-яЁё–—-]{1,60}$/;
    if (next.accountType === 'individual') {
      if (next.firstName && !validName.test(next.firstName)) errors.first_name = 'Только кириллические или латинские буквы и тире.';
      if (next.lastName && !validName.test(next.lastName)) errors.last_name = 'Только кириллические или латинские буквы и тире.';
      if (next.middleName && !validName.test(next.middleName)) errors.middle_name = 'Только кириллические или латинские буквы и тире.';
    }
    const validOrganizationName = /^(?=.*[A-Za-zА-Яа-яЁё])[A-Za-zА-Яа-яЁё0-9 .,"'«»‘’–—‐‑№&-]{1,160}$/u;
    if (next.accountType === 'corporate' && next.organizationName && !validOrganizationName.test(next.organizationName)) {
      errors.organization_name = 'Допустимы буквы, цифры, пробелы, . , кавычки, дефисы, № и &; нужна хотя бы одна буква.';
    }

    const value = next.password;
    if (value.length > 128) errors.password = 'Максимум 128 символов.';
    else if (value && value.length < 8) errors.password = 'Не менее 8 символов.';
    else if (value && !/^[\x21-\x7E]+$/.test(value)) errors.password = 'Без пробелов, используйте латинские символы.';
    else if (value && !/[a-z]/.test(value)) errors.password = 'Добавьте строчную латинскую букву.';
    else if (value && !/[A-Z]/.test(value)) errors.password = 'Добавьте заглавную латинскую букву.';
    else if (value && !/[0-9]/.test(value)) errors.password = 'Добавьте цифру.';
    else if (value && !/[^A-Za-z0-9]/.test(value)) errors.password = 'Добавьте специальный символ.';

    if (next.confirmation && next.confirmation !== next.password) errors.confirmation = 'Пароли должны совпадать.';
    if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) errors.email = 'Проверьте формат e-mail.';
    const secondaryEmail = next.secondaryEmail.trim();
    if (secondaryEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(secondaryEmail)
      || secondaryEmail.length > 254 || secondaryEmail.toLowerCase() === next.email.trim().toLowerCase())) {
      errors.secondary_email = 'Укажите корректный адрес, отличный от основной почты.';
    }
    if (next.githubUrl.trim() && !/^https:\/\/github\.com\/[A-Za-z0-9-]{1,39}\/?$/i.test(next.githubUrl.trim())) {
      errors.github_url = 'Ссылка должна иметь вид https://github.com/username.';
    }
    if (next.telegramUrl.trim() && !/^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}\/?$/i.test(next.telegramUrl.trim())) {
      errors.telegram_url = 'Ссылка должна иметь вид https://t.me/username.';
    }
    return errors;
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setFeedback(validate(form)), 450);
    return () => window.clearTimeout(timer);
  }, [form]);

  function updateField(field, value) {
    const next = { ...form, [field]: value };
    setForm(next);
    const feedbackField = ({
      firstName: 'first_name',
      lastName: 'last_name',
      organizationType: 'organization_type',
      organizationName: 'organization_name',
    })[field] || field;
    setFeedback((current) => ({ ...current, [feedbackField]: '' }));
    if (field === 'email') {
      setEmailCodeSent(false);
      setLocalTestCode('');
      setEmailCode('');
      setEmailInUse(false);
      setExistingEmailAccounts([]);
      setEmailAccountNotice('');
      setResendWait(0);
      setEmailVerified(false);
    }
    setWarning('');
  }

  function readRegistrationAvatar(file) {
    const input = document.querySelector('.register-finish__avatar-input');
    if (input) input.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 1_048_576) {
      setWarning('Выберите JPEG, PNG или WebP размером до 1 МБ.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((current) => ({ ...current, avatar: typeof reader.result === 'string' ? reader.result : null }));
    reader.onerror = () => setWarning('Не удалось прочитать изображение. Попробуйте ещё раз.');
    reader.readAsDataURL(file);
  }

  async function generateSecurePassword() {
    const isPasswordRefresh = hasGeneratedPassword;
    setIsGeneratingPassword(true);
    setHasGeneratedPassword(true);
    const password = createSecurePassword();
    setForm((current) => ({ ...current, password, confirmation: password }));
    setShowConfirmation(true);
    setPasswordCopyStatus('');
    setFeedback((current) => ({ ...current, password: '', confirmation: '' }));
    try {
      await window.navigator.clipboard.writeText(password);
      setPasswordCopyStatus(isPasswordRefresh ? 'Пароль обновлён и скопирован!' : 'Пароль успешно сгенерирован и скопирован!');
    } catch {
      setPasswordCopyStatus(isPasswordRefresh ? 'Пароль обновлён, но скопировать его автоматически не удалось.' : 'Пароль сгенерирован, но скопировать его автоматически не удалось.');
    } finally {
      setIsGeneratingPassword(false);
    }
  }

  async function continueFromUsername() {
    const usernameError = usernameValidationError(form.username);
    setFeedback((current) => ({ ...current, username: usernameError }));
    if (usernameError) return;
    if (!csrfToken || checkingUsername) {
      setWarning('Подождите, пока загрузится защита формы.');
      return;
    }

    setCheckingUsername(true);
    setWarning('');
    try {
      await sendAuthRequest('validate_registration_username', { username: `@${form.username}` }, csrfToken);
      setIdentityStep('password');
    } catch (error) {
      setFeedback((current) => ({ ...current, username: error.message }));
    } finally {
      setCheckingUsername(false);
    }
  }

  function continueFromPassword() {
    const passwordError = validate().password;
    setFeedback((current) => ({ ...current, password: passwordError }));
    if (!passwordError) setShowConfirmation(true);
  }

  function continueFromConfirmation() {
    if (form.confirmation === form.password && form.confirmation) {
      setIdentityStep('name');
    } else {
      setFeedback((current) => ({ ...current, confirmation: 'Пароли должны совпадать.' }));
    }
  }

  function updateAdministrator(id, changes) {
    setAdministrators((current) => {
      const target = current.find((administrator) => administrator.id === id);
      if (!target || target.confirmed) return current;
      if (id !== current[0]?.id && target.editing && changes.identifier !== undefined && changes.identifier.trim() === '') {
        return current.filter((administrator) => administrator.id !== id);
      }
      return current.map((administrator) => (
        administrator.id === id ? { ...administrator, ...changes } : administrator
      ));
    });
    setWarning('');
  }

  async function requestAdministratorConfirmation(administrator) {
    const identifier = administrator.identifier.trim();
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
    const isUsername = /^@[A-Za-z][A-Za-z0-9_-]{2,23}$/.test(identifier);
    if (!isEmail && !isUsername) {
      setWarning('Введите корректный e-mail или логин с @.');
      return;
    }
    if (administrators.some((item) => item.id !== administrator.id && item.identifier.trim().toLowerCase() === identifier.toLowerCase())) {
      setWarning('Этот пользователь уже добавлен.');
      return;
    }

    if (!csrfToken || checkingAdministratorId !== null) {
      setWarning('Подождите, пока загрузится защита формы.');
      return;
    }
    setCheckingAdministratorId(administrator.id);
    try {
      await sendAuthRequest('validate_corporate_admin_identifier', { identifier }, csrfToken);
      setAdminConfirmationId(administrator.id);
    } catch (error) {
      setWarning(error.message);
    } finally {
      setCheckingAdministratorId(null);
    }
  }

  function confirmAdministrator() {
    setAdministrators((current) => current.map((administrator) => (
      administrator.id === adminConfirmationId ? { ...administrator, confirmed: true, editing: false } : administrator
    )));
    setAdminConfirmationId(null);
    setWarning('');
  }

  function editAdministrator(id) {
    setAdministrators((current) => current.map((administrator) => (
      administrator.id === id ? { ...administrator, confirmed: false, editing: true } : administrator
    )));
    setWarning('');
  }

  function addAdministrator() {
    if (administrators.length >= 5 || !administrators.at(-1)?.confirmed) return;
    setAdministrators((current) => [...current, {
      id: nextAdministratorId.current++, role: 'admin', identifier: '', confirmed: false, editing: false,
    }]);
  }

  async function requestEmailCode() {
    const emailError = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) ? '' : 'Введите корректный e-mail.';
    setFeedback((current) => ({ ...current, email: emailError }));
    if (emailError || !csrfToken || sendingEmailCode) return;

    setSendingEmailCode(true);
    setWarning('');
    setEmailInUse(false);
    try {
      const result = await sendAuthRequest('send_verification_code', { email: form.email }, csrfToken);
      const accounts = Array.isArray(result.existing_accounts) ? result.existing_accounts : existingEmailAccounts;
      setExistingEmailAccounts(accounts);
      setEmailAccountNotice(registrationEmailWarning(accounts));
      setLocalTestCode(typeof result.test_code === 'string' ? result.test_code : '');
      setEmailCode('');
      setInvalidEmailCode(false);
      setEmailCodeSent(true);
      setResendWait(60);
      setIdentityStep('email-code');
    } catch (error) {
      if (error.message === 'Этот e-mail уже используется.') setEmailInUse(true);
      else if (error.message.includes('личным и корпоративным аккаунтами')) {
        setExistingEmailAccounts(['individual', 'corporate']);
        setEmailAccountNotice('Нельзя зарегистрировать аккаунт: этот e-mail уже занят и личным, и корпоративным профилем. Войдите в существующий аккаунт или восстановите пароль.');
      }
      else setWarning(error.message);
    } finally {
      setSendingEmailCode(false);
    }
  }

  async function verifyEmailCode(code) {
    if (code.length !== 6 || verifyingCodeRef.current || !csrfToken) return;
    verifyingCodeRef.current = true;
    setVerifyingCode(true);
    setWarning('');
    try {
      const result = await sendAuthRequest('verify_email_code', { email: form.email, code }, csrfToken);
      if (Array.isArray(result.existing_accounts)) {
        setExistingEmailAccounts(result.existing_accounts);
        setEmailAccountNotice(registrationEmailWarning(result.existing_accounts));
      }
      setEmailVerified(true);
      setEmailCodeSent(false);
      setIdentityStep('email-success');
    } catch (error) {
      setEmailCode('');
      setInvalidEmailCode(true);
      setWarning(error.message);
      codeInputRef.current?.focus();
    } finally {
      verifyingCodeRef.current = false;
      setVerifyingCode(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const errors = validate();
    setFeedback(errors);
    const isCorporateAdminStep = identityStep === 'corporate-admin';
    const isFinalStep = identityStep === 'finish';
    if (!['name', 'corporate-admin', 'finish'].includes(identityStep) || !emailVerified) return setWarning('Сначала подтвердите e-mail.');
    if (!form.email.trim()) return setWarning('Введите e-mail.');
    if (!form.username.trim()) return setWarning('Заполните логин.');
    if (!form.password.trim()) return setWarning('Заполните пароль.');
    if (!form.confirmation.trim()) return setWarning('Подтвердите пароль.');
    if (identityStep === 'name' && checkingRegistrationEmail) return setWarning('Проверяем e-mail, подождите секунду.');
    if (identityStep === 'name' && feedback.email) return setWarning(feedback.email);
    if (form.accountType === 'individual' && (!form.firstName.trim() || !form.lastName.trim())) {
      setFeedback((current) => ({ ...current, first_name: form.firstName.trim() ? current.first_name : 'Введите имя.', last_name: form.lastName.trim() ? current.last_name : 'Введите фамилию.' }));
      return setWarning('Заполните имя и фамилию.');
    }
    if (form.accountType === 'corporate' && (!form.organizationType || !form.organizationName.trim())) {
      setFeedback((current) => ({ ...current, organization_type: form.organizationType ? current.organization_type : 'Выберите тип организации.', organization_name: form.organizationName.trim() ? current.organization_name : 'Введите название организации.' }));
      return setWarning('Укажите тип и название организации.');
    }
    const invalidField = Object.keys(errors)[0];
    if (invalidField) {
      const input = document.querySelector(`[name="${invalidField === 'confirmation' ? 'confirmation' : invalidField}"]`);
      const isInlineFinalError = isFinalStep && ['secondary_email', 'github_url', 'telegram_url'].includes(invalidField);
      setWarning(isInlineFinalError ? '' : invalidField === 'confirmation' ? 'Пароли должны совпадать.' : errors[invalidField]);
      input?.focus();
      return;
    }

    if (isCorporateAdminStep) {
      const ownerAdministrators = administrators.filter((administrator) => administrator.role === 'owner');
      if (administrators.some((administrator) => !administrator.confirmed)) {
        return setWarning('Подтвердите добавление каждого администратора.');
      }
      if (ownerAdministrators.length !== 1 || administrators[0]?.role !== 'owner') {
        return setWarning('Первая строка должна содержать единственного владельца аккаунта.');
      }
    }

    if (!isFinalStep && identityStep === 'name') {
      setIdentityStep(form.accountType === 'corporate' ? 'corporate-admin' : 'finish');
      setWarning('');
      return;
    }
    if (isCorporateAdminStep) {
      setIdentityStep('finish');
      setWarning('');
      return;
    }
    if (!form.personalDataConsent) return setWarning('Для завершения регистрации необходимо принять согласие на обработку персональных данных.');

    setBusy(true);
    setWarning('');
    try {
      const result = await sendAuthRequest('register', {
        username: `@${form.username}`,
        first_name: form.accountType === 'individual' ? form.firstName : '',
        last_name: form.accountType === 'individual' ? form.lastName : '',
        middle_name: form.accountType === 'individual' && form.middleName.trim() ? form.middleName : null,
        organization_type: form.accountType === 'corporate' ? form.organizationType : null,
        organization_name: form.accountType === 'corporate' ? form.organizationName : null,
        ...(form.accountType === 'corporate' ? {
          administrators: administrators.map(({ role, identifier }) => ({ role, identifier: identifier.trim() })),
        } : {}),
        password: form.password,
        confirm_password: form.confirmation,
        email: form.email,
        account_type: form.accountType,
        avatar: form.avatar,
        about: form.about,
        secondary_email: form.secondaryEmail,
        github_url: form.githubUrl,
        telegram_url: form.telegramUrl,
        preferred_theme: form.preferredTheme,
        personal_data_consent: form.personalDataConsent,
        marketing_consent: form.marketingConsent,
      }, csrfToken);
      navigationApprovedRef.current = true;
      if (result.upgraded) {
        window.location.assign(result.corporate_account ? '/pages/organization-root.html' : '/pages/workspace.html');
        return;
      }
      const successParams = new URLSearchParams();
      if (result.corporate_account) successParams.set('corporate', 'created');
      if (result.invitation_delivery_failures?.length) successParams.set('invitations', 'failed');
      try {
        window.sessionStorage.setItem('todo-inn-registration-welcome', JSON.stringify({
          name: result.corporate_account
            ? `${form.organizationType} «${form.organizationName.trim()}»`
            : form.firstName.trim(),
          corporate: Boolean(result.corporate_account),
        }));
      } catch {
        // The success screen has a generic welcome fallback when session storage is unavailable.
      }
      const query = successParams.size ? `?${successParams.toString()}` : '';
      window.location.assign(`/pages/registration-success.html${query}`);
    } catch (error) {
      setWarning(error.message);
      if (/логин|e-mail|email/i.test(error.message)) {
        setFeedback((current) => ({ ...current, username: error.message, email: error.message }));
      } else if (/парол/i.test(error.message)) {
        setFeedback((current) => ({ ...current, password: error.message }));
      } else if (/имя|фамили/i.test(error.message)) {
        setFeedback((current) => ({ ...current, first_name: error.message, last_name: error.message }));
      } else if (/организац/i.test(error.message)) {
        setFeedback((current) => ({ ...current, organization_type: error.message, organization_name: error.message }));
      }
      setBusy(false);
    }
  }

  const passwordToggle = () => setVisiblePasswords((current) => !current);
  const administratorToConfirm = administrators.find((administrator) => administrator.id === adminConfirmationId);
  const isFinalStep = identityStep === 'finish';
  const registrationProgress = {
    email: '1/8',
    'email-code': '2/8',
    'email-success': '3/8',
    username: '4/8',
    password: showConfirmation ? '6/8' : '5/8',
    name: '7/8',
    finish: '8/8',
  }[identityStep];
  const registrationMotivation = {
    email: ['Начнём с простого', 'Укажите почту, чтобы создать аккаунт'],
    'email-code': ['Почти готово — подтвердите почту', 'Код уже ждёт вас в письме'],
    'email-success': ['Отличный старт!', 'Почта подтверждена — идём дальше'],
    username: ['Выберите свой логин', 'Так вас смогут найти другие пользователи'],
    password: showConfirmation
      ? ['Ещё один быстрый шаг', 'Повторите пароль для проверки']
      : ['Создайте надёжную защиту', 'Придумайте пароль для аккаунта'],
    name: ['Расскажите немного о себе', 'Выберите тип аккаунта и заполните основные данные'],
    'corporate-admin': ['Соберите команду', null],
    finish: ['Осталось совсем чуть-чуть!', 'Заполните необязательные настройки или пропустите их'],
  }[identityStep];
  const registrationTitle = {
    email: 'Создать аккаунт',
    'email-code': 'Подтвердите почту',
    'email-success': 'Почта подтверждена',
    username: 'Выберите логин',
    password: showConfirmation ? 'Подтвердите пароль' : 'Придумайте пароль',
    name: 'Создайте свой аккаунт',
    'corporate-admin': 'Назначьте администраторов',
    finish: 'Настройте профиль',
  }[identityStep];

  return (
    <AuthLayout wide={identityStep === 'corporate-admin' || identityStep === 'finish'} corporateAdmin={identityStep === 'corporate-admin'}>
      <AuthHeader eyebrow={upgradeMode ? 'ОБНОВЛЕНИЕ АККАУНТА' : registrationMotivation[0]} title={upgradeMode ? 'Обновите данные' : registrationTitle} progress={registrationProgress}>
        {upgradeMode
          ? <>Подтвердите почту и задайте новый логин и пароль. Ваши доски, списки и задачи останутся на месте.{form.accountType === 'corporate' && ' Корпоративный аккаунт будет создан отдельно, без переноса старых досок.'}</>
          : registrationMotivation[1]}
      </AuthHeader>
      <form className="auth-form" noValidate onSubmit={handleSubmit}>
        <div className={`register-identity is-${identityStep}-step`}>
          <div className={`register-identity__step register-identity__step--email${identityStep === 'email' ? ' is-active' : ''}`} aria-hidden={identityStep !== 'email'} inert={identityStep !== 'email'}>
            <div className="auth-form__field">
              <label htmlFor="email">{upgradeMode ? 'Новая электронная почта' : 'Электронная почта'}</label>
              <input id="email" name="email" type="email" autoComplete="email" placeholder="name@example.com" value={form.email} aria-invalid={Boolean(feedback.email || emailInUse)} onChange={(event) => updateField('email', event.target.value)} onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                requestEmailCode();
              }} required />
              {feedback.email && <p className="auth-form__feedback is-invalid">{feedback.email}</p>}
              {emailAccountNotice && <p className={`register-email-warning${existingEmailAccounts.length > 1 ? ' is-error' : ''}`} role={existingEmailAccounts.length > 1 ? 'alert' : 'status'}>{emailAccountNotice}</p>}
              {emailInUse && <div className="register-email-taken" role="status"><p>Этот e-mail уже зарегистрирован.</p><a href="/">Войти</a><a href="/pages/forgot-password.html">Восстановить пароль</a></div>}
              <p className="register-enter-hint">Нажмите Enter, чтобы продолжить</p>
              {form.email && <button className="register-step-next" type="button" onClick={requestEmailCode} disabled={sendingEmailCode || existingEmailAccounts.length > 1}>{sendingEmailCode ? 'Отправляем…' : 'Далее'}</button>}
            </div>
          </div>
          <div className={`register-identity__step register-identity__step--email-code${identityStep === 'email-code' ? ' is-active' : ''}`} aria-hidden={identityStep !== 'email-code'} inert={identityStep !== 'email-code'}>
            <button className="register-identity__back" type="button" onClick={() => setIdentityStep('email')}><span aria-hidden="true">←</span> Вернуться</button>
            <div className="auth-form__field">
              <label htmlFor="email-code">Подтвердите почту</label>
              <p className="register-identity__email">{emailCodeSent ? localTestCode ? 'Локальный код для тестирования:' : `Мы отправили код на ${form.email}` : form.email}</p>
              {emailAccountNotice && <p className={`register-email-warning${existingEmailAccounts.length > 1 ? ' is-error' : ''}`} role={existingEmailAccounts.length > 1 ? 'alert' : 'status'}>{emailAccountNotice}</p>}
              {localTestCode && <p className="register-identity__test-code">{localTestCode}</p>}
              <div className={`register-code${invalidEmailCode ? ' is-invalid' : ''}`} onClick={() => codeInputRef.current?.focus()}>
                <div className="register-code__slots" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span className={`${emailCode[index] ? 'is-filled' : ''}${index === Math.min(emailCode.length, 5) ? ' is-current' : ''}`} key={index}>{emailCode[index] || ''}</span>)}</div>
                <input ref={codeInputRef} id="email-code" name="email_code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={emailCode} disabled={verifyingCode} aria-invalid={invalidEmailCode || undefined} onChange={(event) => { const code = event.target.value.replace(/\D/g, '').slice(0, 6); setInvalidEmailCode(false); setWarning(''); setEmailCode(code); if (code.length === 6) verifyEmailCode(code); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); verifyEmailCode(emailCode); } }} aria-label="Шестизначный код подтверждения" />
              </div>
              <p className="register-identity__hint">{verifyingCode ? 'Проверяем код…' : 'Введите шестизначный код'}</p>
              <div className="register-identity__code-actions"><button type="button" onClick={() => { setIdentityStep('email'); setEmailCodeSent(false); setEmailCode(''); setResendWait(0); setEmailVerified(false); }}>Изменить e-mail</button><button type="button" onClick={requestEmailCode} disabled={resendWait > 0 || sendingEmailCode}>{sendingEmailCode ? 'Отправляем…' : resendWait > 0 ? `Отправить ещё раз через 00:${String(resendWait).padStart(2, '0')}` : 'Отправить ещё раз'}</button></div>
            </div>
          </div>
          <div className={`register-identity__step register-identity__step--email-success${identityStep === 'email-success' ? ' is-active' : ''}`} aria-hidden={identityStep !== 'email-success'} inert={identityStep !== 'email-success'}>
            <div className="register-email-success"><span aria-hidden="true">✓</span><div><strong>Почта успешно подтверждена!</strong><p>Отлично! Теперь выберем логин.</p></div></div>
          </div>
          <div className={`register-identity__step register-identity__step--username${identityStep === 'username' ? ' is-active' : ''}`} aria-hidden={identityStep !== 'username'} inert={identityStep !== 'username'}>
            <button className="register-identity__back" type="button" onClick={() => setIdentityStep('email')}><span aria-hidden="true">←</span> Вернуться</button>
            <div className="auth-form__field">
              <label htmlFor="username">Логин</label>
              <div className="register-username-control"><span aria-hidden="true">@</span><input ref={usernameInputRef} id="username" name="username" autoComplete="username" maxLength={23} value={form.username} onChange={(event) => updateField('username', event.target.value)} onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                continueFromUsername();
              }} aria-invalid={Boolean(feedback.username)} required /></div>
              {feedback.username && <p className="auth-form__feedback is-invalid">{feedback.username}</p>}
              <p className="register-identity__hint">Логин — это идентификатор, по которому вас смогут найти другие пользователи.</p>
              <p className="register-username-preview" aria-live="polite">Ваш логин: <strong>@{form.username}</strong></p>
              <p className="register-enter-hint">Нажмите Enter, чтобы продолжить</p>
              {form.username && <button className="register-step-next" type="button" onClick={continueFromUsername} disabled={checkingUsername}>{checkingUsername ? 'Проверяем…' : 'Далее'}</button>}
            </div>
          </div>
          <div className={`register-identity__step register-identity__step--password${identityStep === 'password' ? ' is-active' : ''}`} aria-hidden={identityStep !== 'password'} inert={identityStep !== 'password'}>
            <button className="register-identity__back" type="button" onClick={() => setIdentityStep('username')}><span aria-hidden="true">←</span> Вернуться</button>
            <div className="register-password-group">
              <PasswordField inputRef={passwordInputRef} id="password" label="Безопасный пароль" value={form.password} onChange={(event) => updateField('password', event.target.value)} onKeyDown={(event) => { if (event.key !== 'Enter') return; event.preventDefault(); continueFromPassword(); }} visible={visiblePasswords} onToggle={passwordToggle} autoComplete="new-password" placeholder="Придумайте пароль" hint="От 8 символов: строчная и заглавная латинские буквы, цифра и символ." feedback={feedback.password} invalid={Boolean(feedback.password)} />
              {!showConfirmation && <p className="register-enter-hint">Нажмите Enter, чтобы продолжить</p>}
              <button className="register-password-generate" type="button" onClick={generateSecurePassword} disabled={isGeneratingPassword}>
                {isGeneratingPassword ? <span className="register-password-generate__loading" aria-hidden="true"><img src={keyIcon} alt="" /><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" /></svg></span> : <img src={keyIcon} alt="" aria-hidden="true" />}
                <span>{isGeneratingPassword ? 'Генерируем пароль…' : 'Сгенерировать безопасный пароль'}</span>
              </button>
              {passwordCopyStatus && <p className="register-password-copy-status" role="status">{passwordCopyStatus}</p>}
              {form.password && !showConfirmation && <button className="register-step-next" type="button" onClick={continueFromPassword}>Далее</button>}
              {showConfirmation && <div className="register-password-confirmation"><PasswordField inputRef={confirmationInputRef} id="confirmation" label="Подтвердите пароль" value={form.confirmation} onChange={(event) => updateField('confirmation', event.target.value)} onKeyDown={(event) => { if (event.key !== 'Enter') return; event.preventDefault(); continueFromConfirmation(); }} visible={visiblePasswords} onToggle={passwordToggle} autoComplete="new-password" placeholder="Повторите пароль" feedback={feedback.confirmation} invalid={Boolean(feedback.confirmation)} /><p className="register-enter-hint">Нажмите Enter, чтобы продолжить</p></div>}
              {showConfirmation && form.confirmation && <button className="register-step-next register-step-next--confirmation" type="button" onClick={continueFromConfirmation}>Далее</button>}
            </div>
          </div>
          <div className={`register-identity__step register-identity__step--name${identityStep === 'name' ? ' is-active' : ''}`} aria-hidden={identityStep !== 'name'} inert={identityStep !== 'name'}>
            <button className="register-identity__back" type="button" onClick={() => setIdentityStep('password')}><span aria-hidden="true">←</span> Вернуться</button>
            <fieldset className="register-account-type">
              <legend>Тип аккаунта</legend>
              <div className="register-account-type__options">
                {[
                  ['individual', 'Личный', 'Для личных задач'],
                  ['corporate', 'Корпоративный', 'Для организаций'],
                ].map(([value, label, description]) => (
                  <label className="register-account-type__option" key={value}>
                    <input type="radio" name="account_type" value={value} checked={form.accountType === value} onChange={() => updateField('accountType', value)} />
                    <img className="register-account-type__icon" src={value === 'individual' ? personalAccountIcon : corporateAccountIcon} alt="" aria-hidden="true" />
                    <span className="register-account-type__copy"><strong>{label}</strong><small>{description}</small></span>
                  </label>
                ))}
              </div>
            </fieldset>
            {feedback.email && <p className="auth-form__feedback is-invalid" role="alert">{feedback.email}</p>}
            {form.accountType === 'individual' ? (
              <div className="register-personal-fields">
                <div className="auth-form__field"><label htmlFor="last-name">Фамилия</label><input id="last-name" name="last_name" autoComplete="family-name" placeholder="Фамилия" value={form.lastName} onChange={(event) => updateField('lastName', event.target.value)} aria-invalid={Boolean(feedback.last_name)} required />{feedback.last_name && <p className="auth-form__feedback is-invalid">{feedback.last_name}</p>}</div>
                {form.lastName.length > 0 && <>
                  <div className="auth-form__field register-personal-fields__revealed"><label htmlFor="first-name">Имя</label><input id="first-name" name="first_name" autoComplete="given-name" placeholder="Имя" value={form.firstName} onChange={(event) => updateField('firstName', event.target.value)} aria-invalid={Boolean(feedback.first_name)} required />{feedback.first_name && <p className="auth-form__feedback is-invalid">{feedback.first_name}</p>}</div>
                  {form.firstName.length > 0 && <div className="auth-form__field register-personal-fields__revealed"><label htmlFor="middle-name">Отчество <span className="register-personal-fields__optional">необязательно</span></label><input id="middle-name" name="middle_name" autoComplete="additional-name" placeholder="Отчество" value={form.middleName} onChange={(event) => updateField('middleName', event.target.value)} aria-invalid={Boolean(feedback.middle_name)} />{feedback.middle_name && <p className="auth-form__feedback is-invalid">{feedback.middle_name}</p>}</div>}
                </>}
              </div>
            ) : (
              <div className="register-account-details register-organization-card">
                <div className="register-organization-card__heading"><strong>Данные организации</strong><small>Укажите форму и официальное название</small></div>
                  <div className="register-organization-fields"><CustomSelect id="organization-type" label="Форма организации" value={form.organizationType} options={['ИП', 'ООО', 'ПАО', 'НПАО', 'НКО', 'ГУП', 'МУП', 'Другое']} onChange={(value) => updateField('organizationType', value)} /><input id="organization-name" name="organization_name" aria-label="Название организации" autoComplete="organization" placeholder="Название организации" value={form.organizationName} onChange={(event) => updateField('organizationName', event.target.value)} aria-invalid={Boolean(feedback.organization_name)} required /></div>
                {(feedback.organization_type || feedback.organization_name) && <p className="auth-form__feedback is-invalid">{feedback.organization_type || feedback.organization_name}</p>}
              </div>
            )}
          </div>
          <div className={`register-identity__step register-identity__step--corporate-admin${identityStep === 'corporate-admin' ? ' is-active' : ''}`} aria-hidden={identityStep !== 'corporate-admin'} inert={identityStep !== 'corporate-admin'}>
            <button className="register-identity__back" type="button" onClick={() => setIdentityStep('name')}><span aria-hidden="true">←</span> Вернуться к данным организации</button>
            <section className="register-corporate-admin" aria-label="Администраторы корпоративного аккаунта">
              <div className="register-admin-list">
                {administrators.map((administrator, index) => {
                  return (
                    <div className={`register-admin-row${administrator.confirmed ? ' is-confirmed' : ''}`} key={administrator.id}>
                      {index === 0 ? (
                        <span className="register-admin-row__owner-role" aria-label="Роль: owner">owner</span>
                      ) : (
                        <CustomSelect
                          id={`admin-role-${administrator.id}`}
                          label={`Роль администратора ${index + 1}`}
                          value={administrator.role}
                          options={['admin', 'manager', 'support']}
                          disabled={administrator.confirmed}
                          onChange={(role) => updateAdministrator(administrator.id, { role })}
                        />
                      )}
                      <input
                        aria-label={`Логин или почта администратора ${index + 1}`}
                        autoComplete="off"
                        placeholder="Логин или почта админа"
                        value={administrator.identifier}
                        readOnly={administrator.confirmed}
                        onChange={(event) => updateAdministrator(administrator.id, { identifier: event.target.value })}
                      />
                      {administrator.confirmed ? (
                        <button className="register-admin-row__edit" type="button" aria-label={`Изменить контакт администратора ${index + 1}`} onClick={() => editAdministrator(administrator.id)}>
                          <svg className="register-admin-row__check" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>
                          <svg className="register-admin-row__pencil" viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4.5 3 3M4 16l3.4-.7 8.5-8.5a2.1 2.1 0 0 0-3-3l-8.5 8.5L4 16Z" /></svg>
                        </button>
                      ) : administrator.identifier.trim() ? (
                        <button
                          className={`register-admin-row__confirm${checkingAdministratorId === administrator.id ? ' is-checking' : ''}`}
                          type="button"
                          aria-label={`Подтвердить добавление администратора ${index + 1}`}
                          disabled={checkingAdministratorId !== null}
                          onClick={() => requestAdministratorConfirmation(administrator)}
                        >{checkingAdministratorId === administrator.id ? <span className="register-admin-row__spinner" aria-hidden="true" /> : <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>}</button>
                      ) : null}
                    </div>
                  );
                })}
                {administrators.length < 5 && administrators.every((administrator) => administrator.confirmed) && (
                  <button className="register-admin-add" type="button" onClick={addAdministrator}>
                    <span className="register-admin-add__icon" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 4v12M4 10h12" /></svg></span> Добавить администратора
                  </button>
                )}
              </div>
            </section>
          </div>
          <div className={`register-identity__step register-identity__step--finish${isFinalStep ? ' is-active' : ''}`} aria-hidden={!isFinalStep} inert={!isFinalStep}>
            <button className="register-identity__back" type="button" onClick={() => setIdentityStep(form.accountType === 'corporate' ? 'corporate-admin' : 'name')}><span aria-hidden="true">←</span> Назад</button>
            <section className="register-finish">
              <p className="register-finish__optional">Необязательные настройки — их можно заполнить позже.</p>
              <div className="register-avatar-picker">
                <span className="register-avatar-picker__preview">{form.avatar ? <img src={form.avatar} alt="Предпросмотр аватара" /> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>}</span>
                <div className="register-avatar-picker__content"><strong>Аватар</strong><small>Необязательно · JPEG, PNG или WebP до 1 МБ</small><div className="register-avatar-picker__actions"><label className="register-avatar-picker__button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4m-4 4 4-4 4 4"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg>{form.avatar ? 'Заменить фото' : 'Выбрать фото'}<input className="register-finish__avatar-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => readRegistrationAvatar(event.target.files?.[0])} /></label>{form.avatar && <button className="register-avatar-picker__remove" type="button" onClick={() => setForm((current) => ({ ...current, avatar: null }))}>Удалить</button>}</div></div>
              </div>
              <label className="register-finish__field"><span>{form.accountType === 'corporate' ? 'Описание организации' : 'О себе'}</span><textarea maxLength={1200} value={form.about} onChange={(event) => setForm((current) => ({ ...current, about: event.target.value }))} /></label>
              <label className="register-finish__field"><span>Дополнительная почта</span><input name="secondary_email" type="email" maxLength={254} autoComplete="email" value={form.secondaryEmail} aria-invalid={Boolean(feedback.secondary_email)} onChange={(event) => setForm((current) => ({ ...current, secondaryEmail: event.target.value }))} onBlur={() => setFeedback((current) => ({ ...current, secondary_email: validate().secondary_email || '' }))} placeholder="name@example.com" />{feedback.secondary_email && <small className="register-inline-feedback" role="alert">{feedback.secondary_email}</small>}</label>
              <div className="register-social-fields">
                <label className="register-finish__field"><span>GitHub</span><span className={`register-social-input${feedback.github_url ? ' is-invalid' : ''}`}><svg className="register-social-input__github" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.56.1.76-.24.76-.54v-2.08c-3.1.67-3.76-1.32-3.76-1.32-.5-1.28-1.23-1.62-1.23-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15 1 1.7 2.61 1.21 3.25.93.1-.72.39-1.21.71-1.49-2.48-.28-5.09-1.24-5.09-5.52 0-1.22.44-2.22 1.15-3-.12-.28-.5-1.42.11-2.96 0 0 .94-.3 3.06 1.15a10.6 10.6 0 0 1 5.57 0c2.12-1.45 3.05-1.15 3.05-1.15.61 1.54.23 2.68.12 2.96.71.78 1.14 1.78 1.14 3.01 0 4.29-2.62 5.23-5.11 5.5.4.35.75 1.03.75 2.08v3.09c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z"/></svg><input name="github_url" type="url" maxLength={255} value={form.githubUrl} aria-invalid={Boolean(feedback.github_url)} onChange={(event) => setForm((current) => ({ ...current, githubUrl: event.target.value }))} onBlur={() => setFeedback((current) => ({ ...current, github_url: validate().github_url || '' }))} placeholder="https://github.com/username" /></span>{feedback.github_url && <small className="register-inline-feedback" role="alert">{feedback.github_url}</small>}</label>
                <label className="register-finish__field"><span>Telegram</span><span className={`register-social-input${feedback.telegram_url ? ' is-invalid' : ''}`}><svg className="register-social-input__telegram" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.7 3.3 18.5 20c-.24 1.18-.87 1.47-1.76.91l-4.86-3.58-2.35 2.26c-.26.26-.48.48-.98.48l.35-4.94 8.99-8.12c.39-.35-.08-.55-.6-.2L6.17 13.87l-4.8-1.5c-1.04-.33-1.06-1.04.22-1.55L20.38 3.1c.86-.32 1.61.2 1.33.2Z"/></svg><input name="telegram_url" type="url" maxLength={255} value={form.telegramUrl} aria-invalid={Boolean(feedback.telegram_url)} onChange={(event) => setForm((current) => ({ ...current, telegramUrl: event.target.value }))} onBlur={() => setFeedback((current) => ({ ...current, telegram_url: validate().telegram_url || '' }))} placeholder="https://t.me/username" /></span>{feedback.telegram_url && <small className="register-inline-feedback" role="alert">{feedback.telegram_url}</small>}</label>
              </div>
              <fieldset className="register-theme-picker"><legend>Тема по умолчанию</legend><div className="register-theme-picker__options">
                {[
                  ['light', 'Светлая', <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>],
                  ['dark', 'Тёмная', <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z"/></svg>],
                  ['system', 'Системная', <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></svg>],
                ].map(([value, label, icon]) => <label className="register-theme-picker__option" key={value}><input type="radio" name="preferred-theme" value={value} checked={form.preferredTheme === value} onChange={() => setForm((current) => ({ ...current, preferredTheme: value }))}/><span className="register-theme-picker__icon">{icon}</span><strong>{label}</strong><span className="register-theme-picker__check" aria-hidden="true">✓</span></label>)}
              </div></fieldset>
              <label className="register-consent-card is-required"><input type="checkbox" checked={form.personalDataConsent} onChange={(event) => setForm((current) => ({ ...current, personalDataConsent: event.target.checked }))} /><span className="register-consent-card__check" aria-hidden="true">✓</span><span className="register-consent-card__copy"><span><strong>Обработка персональных данных</strong><em>Обязательно</em></span><small>Согласие на использование данных для создания аккаунта и работы сервиса.</small></span></label>
              <details className="register-finish__draft"><summary>Черновик: что означает согласие</summary><p>Для регистрации и предоставления функций сервиса могут обрабатываться указанные вами имя, адреса электронной почты, логин, описание и аватар. До публичного запуска этот текст необходимо заменить утверждённой политикой с данными оператора, целями, сроками хранения, порядком отзыва и ссылкой на полную политику.</p></details>
              <label className="register-consent-card"><input type="checkbox" checked={form.marketingConsent} onChange={(event) => setForm((current) => ({ ...current, marketingConsent: event.target.checked }))} /><span className="register-consent-card__check" aria-hidden="true">✓</span><span className="register-consent-card__copy"><span><strong>Новости и аналитика</strong><em>Необязательно</em></span><small>Можно получать предложения и помогать улучшать сервис. На регистрацию не влияет.</small></span></label>
            </section>
          </div>
        </div>
        {(warning || connectionError) && <p className="auth-form__submit-warning" role="alert">{warning || connectionError}</p>}

        {(identityStep === 'name' || identityStep === 'corporate-admin' || identityStep === 'finish') && <>
        <button className={`auth-form__submit${identityStep === 'corporate-admin' ? ' register-corporate-admin__submit' : ''}`} type="submit" disabled={!csrfToken || busy}>{busy ? 'Создаём аккаунт…' : identityStep === 'finish' ? 'Зарегистрироваться' : 'Далее'}</button>
        </>}
      </form>
      {administratorToConfirm && <div className="register-admin-confirm-backdrop"><section className="register-admin-confirm" role="dialog" aria-modal="true" aria-labelledby="register-admin-confirm-title"><h2 id="register-admin-confirm-title">Подтвердите добавление</h2><p><strong>{administratorToConfirm.identifier}</strong><span>Роль: {administratorToConfirm.role}</span></p><div><button className="is-secondary" type="button" onClick={() => setAdminConfirmationId(null)}>Отмена</button><button type="button" onClick={confirmAdministrator}>Добавить</button></div></section></div>}
      <p className="auth-card__footer">Уже есть аккаунт? <a href="/">Войти</a></p>
    </AuthLayout>
  );
}

function RecoveryPage() {
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

function CorporateInvitationPage() {
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

function RegistrationSuccessPage() {
  const corporateCreated = new URLSearchParams(window.location.search).get('corporate') === 'created';
  const invitationsFailed = new URLSearchParams(window.location.search).get('invitations') === 'failed';
  const [welcome] = useState(() => {
    try {
      const stored = JSON.parse(window.sessionStorage.getItem('todo-inn-registration-welcome') || 'null');
      window.sessionStorage.removeItem('todo-inn-registration-welcome');
      return stored && typeof stored.name === 'string' ? stored.name : '';
    } catch {
      return '';
    }
  });
  const [slide, setSlide] = useState(0);
  const [preparing, setPreparing] = useState(true);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const timers = [
      window.setTimeout(() => setSlide(1), 800),
      window.setTimeout(() => setSlide(2), 1600),
      window.setTimeout(() => setPreparing(false), 2400),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, []);

  function enterWorkspace() {
    if (leaving) return;
    setLeaving(true);
    if (!corporateCreated) {
      try { window.sessionStorage.setItem('todo-inn-registration-arrival', '1'); } catch { /* Transition is an enhancement only. */ }
    }
    window.setTimeout(() => window.location.assign(corporateCreated ? '/' : '/pages/workspace.html'), 650);
  }

  const preparationSlides = [
    { icon: '✨', text: 'Создаём ваш аккаунт' },
    { icon: '🧩', text: 'Готовим рабочее пространство' },
    { icon: '🚀', text: 'Настраиваем всё для первого старта' },
  ];

  return (
    <AuthLayout success finale>
      <div className={`registration-finale${preparing ? ' is-preparing' : ' is-welcome'}${leaving ? ' is-leaving' : ''}`} aria-live="polite" aria-busy={preparing}>
        {preparing ? (
          <div className="registration-finale__preparing" key={slide}>
            <span className="registration-finale__orbit" aria-hidden="true"><span>{preparationSlides[slide].icon}</span></span>
            <p className="registration-finale__eyebrow">Финальные штрихи</p>
            <h1>{preparationSlides[slide].text}</h1>
            <div className="registration-finale__progress" aria-hidden="true">{preparationSlides.map((item, index) => <span className={index <= slide ? 'is-active' : ''} key={item.icon} />)}</div>
          </div>
        ) : (
          <div className="registration-finale__welcome">
            <span className="registration-finale__celebration" aria-hidden="true">{corporateCreated ? '🎉' : '✨'}</span>
            <p className="registration-finale__eyebrow">Регистрация успешно завершена</p>
            <h1>{corporateCreated ? 'Всё готово!' : `Добро пожаловать${welcome ? `, ${welcome}` : ''}!`}</h1>
            <p className="registration-finale__description">{corporateCreated
              ? 'Организация создана. Владелец получит приглашение для первого входа в рабочее пространство.'
              : 'Ваше рабочее пространство уже ждёт. Можно переходить к планам и задачам.'}</p>
            {invitationsFailed && <p className="registration-finale__notice" role="alert">Аккаунт создан, но часть приглашений не отправилась. Проверьте почту или адреса приглашённых.</p>}
            <button className="registration-finale__button" type="button" onClick={enterWorkspace} disabled={leaving}>
              {corporateCreated ? 'Вернуться ко входу' : 'Перейти в рабочее пространство'}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
            </button>
          </div>
        )}
      </div>
    </AuthLayout>
  );
}

function OrganizationRootPage() {
  const { csrfToken, connectionError } = useCsrfToken();
  const [message, setMessage] = useState('');
  const [organization, setOrganization] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [notificationError, setNotificationError] = useState('');
  const [notificationBusyId, setNotificationBusyId] = useState(null);

  useEffect(() => {
    getSession().then(({ corporate_account: account }) => setOrganization(account || null)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!csrfToken) return undefined;
    let active = true;
    sendAuthRequest('get_notifications', {}, csrfToken)
      .then((data) => { if (active) setNotifications(data.notifications || []); })
      .catch((error) => { if (active) setNotificationError(error.message); });
    return () => { active = false; };
  }, [csrfToken]);

  async function markNotificationRead(notification) {
    if (notification.is_read || notificationBusyId !== null) return;
    setNotificationBusyId(notification.id);
    setNotificationError('');
    try {
      await sendAuthRequest('mark_notification_read', { notification_id: notification.id }, csrfToken);
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, is_read: true } : item));
    } catch (error) {
      setNotificationError(error.message);
    } finally {
      setNotificationBusyId(null);
    }
  }

  async function logout() {
    if (!csrfToken) return;
    try {
      await sendAuthRequest('logout', {}, csrfToken);
      window.location.replace('/');
    } catch (error) {
      setMessage(error.message);
    }
  }

  return (
    <AuthLayout success>
      <div className="organization-root-notifications"><NotificationsMenu notifications={notifications} unreadCount={notifications.filter((item) => !item.is_read).length} onRead={markNotificationRead} busyId={notificationBusyId} error={notificationError} /></div>
      <AuthHeader eyebrow="ROOT-АККАУНТ ОРГАНИЗАЦИИ" title="Фундаментальные настройки">
        Root-аккаунт организации не используется для повседневной работы сотрудников.
      </AuthHeader>
      {organization && <section className="auth-form__status organization-root-profile">
        {organization.avatar && <img src={organization.avatar} alt="Аватар организации" />}
        <h2>{organization.name}</h2>
        {organization.description && <p>{organization.description}</p>}
        {organization.secondary_email && <p>Дополнительная почта: {organization.secondary_email}</p>}
        {organization.github_url && <p>GitHub: <a href={organization.github_url} target="_blank" rel="noreferrer">{organization.github_url}</a></p>}
        {organization.telegram_url && <p>Telegram: <a href={organization.telegram_url} target="_blank" rel="noreferrer">{organization.telegram_url}</a></p>}
        <p>Тема по умолчанию: {organization.preferred_theme === 'system' ? 'системная' : organization.preferred_theme === 'dark' ? 'тёмная' : 'светлая'}</p>
      </section>}
      <p className="auth-form__hint">Общие доски и приглашения управляются из личного аккаунта owner. Здесь сохранены стартовые настройки организации.</p>
      {(message || connectionError) && <p className="auth-form__submit-warning" role="alert">{message || connectionError}</p>}
      <button className="auth-form__submit" type="button" onClick={logout} disabled={!csrfToken}>Выйти из root-аккаунта</button>
      <p className="auth-card__footer"><a href="/">Войти в личный аккаунт</a></p>
    </AuthLayout>
  );
}

export function AuthPages({ page }) {
  if (page === 'register') return <RegisterPage />;
  if (page === 'corporate-invitation') return <CorporateInvitationPage />;
  if (page === 'organization-root') return <OrganizationRootPage />;
  if (page === 'recovery') return <RecoveryPage />;
  if (page === 'registration-success') return <RegistrationSuccessPage />;
  return <LoginPage />;
}
