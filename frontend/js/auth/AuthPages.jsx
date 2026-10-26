import React, { useEffect, useState } from 'react';
import { getSession, sendAuthRequest } from '../api.js';

const logo = 'To Do Inn!';

function Brand() {
  return (
    <div className="auth-card__brand">
      <span className="auth-card__mark" aria-hidden="true">✓</span>
      <span>{logo}</span>
    </div>
  );
}

function AuthLayout({ children, wide = false, success = false }) {
  const className = ['auth-card', wide && 'auth-card--wide', success && 'auth-card--success']
    .filter(Boolean)
    .join(' ');

  return (
    <main className={`auth-page${success ? ' auth-page--success' : ''}`}>
      <section className={className}>
        <Brand />
        {children}
      </section>
    </main>
  );
}

function AuthHeader({ eyebrow, title, children }) {
  return (
    <header className="auth-card__header">
      <p className="auth-card__eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{children}</p>
    </header>
  );
}

function PasswordField({ id, label, value, onChange, visible, onToggle, autoComplete, placeholder, hint, feedback, invalid }) {
  return (
    <div className="auth-form__field">
      <label htmlFor={id}>{label}</label>
      <div className="password-control">
        <input
          id={id}
          name={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          aria-invalid={invalid || undefined}
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
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await sendAuthRequest('login', { username, password }, csrfToken);
      window.location.assign('/pages/workspace.html');
    } catch (error) {
      setMessage(error.message);
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <AuthHeader eyebrow="ВАШЕ ПРОСТРАНСТВО ДЛЯ ДЕЛ" title="С возвращением">
        Войдите, чтобы продолжить работу со своими задачами.
      </AuthHeader>
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-form__field">
          <label htmlFor="username">Логин</label>
          <input id="username" name="username" autoComplete="username" placeholder="Ваш логин" value={username} onChange={(event) => setUsername(event.target.value)} required />
        </div>
        <PasswordField
          id="password"
          label="Пароль"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          visible={passwordVisible}
          onToggle={() => setPasswordVisible((current) => !current)}
          autoComplete="current-password"
          placeholder="Ваш пароль"
        />
        <a className="auth-form__forgot" href="/pages/forgot-password.html">Забыли пароль?</a>
        {(message || connectionError) && <p className="auth-form__status" role="alert">{message || connectionError}</p>}
        <button className="auth-form__submit" type="submit" disabled={!csrfToken || busy}>{busy ? 'Входим…' : 'Войти'}</button>
      </form>
      <p className="auth-card__footer">Нет аккаунта? <a href="/pages/register.html">Зарегистрироваться</a></p>
    </AuthLayout>
  );
}

function RegisterPage() {
  const { csrfToken, connectionError } = useCsrfToken();
  const [form, setForm] = useState({ username: '', password: '', confirmation: '', email: '', accountType: 'individual' });
  const [visiblePasswords, setVisiblePasswords] = useState(false);
  const [feedback, setFeedback] = useState({});
  const [warning, setWarning] = useState('');
  const [busy, setBusy] = useState(false);

  function validate(next = form) {
    const errors = {};
    const validUsername = /^[A-Za-z][A-Za-z0-9_]{2,23}$/.test(next.username);
    if (next.username && !validUsername) errors.username = 'Проверьте логин.';

    const value = next.password;
    if (value.length > 128) errors.password = 'Максимум 128 символов.';
    else if (value && value.length < 6) errors.password = 'Не менее 6 символов.';
    else if (value && !/^[\x21-\x7E]+$/.test(value)) errors.password = 'Без пробелов, используйте латинские символы.';
    else if (value && !/[A-Za-z]/.test(value)) errors.password = 'Добавьте латинскую букву.';
    else if (value && !/[0-9]/.test(value)) errors.password = 'Добавьте цифру.';

    if (next.confirmation && next.confirmation !== next.password) errors.confirmation = 'Пароли должны совпадать.';
    if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) errors.email = 'Проверьте формат e-mail.';
    return errors;
  }

  function updateField(field, value) {
    const next = { ...form, [field]: value };
    setForm(next);
    setFeedback(validate(next));
    setWarning('');
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const errors = validate();
    setFeedback(errors);
    if (!form.username.trim()) return setWarning('Заполните логин.');
    if (!form.password.trim()) return setWarning('Заполните пароль.');
    if (!form.confirmation.trim()) return setWarning('Подтвердите пароль.');
    const invalidField = Object.keys(errors)[0];
    if (invalidField) {
      const input = document.querySelector(`[name="${invalidField === 'confirmation' ? 'confirmation' : invalidField}"]`);
      setWarning(invalidField === 'confirmation' ? 'Пароли должны совпадать.' : errors[invalidField]);
      input?.focus();
      return;
    }

    setBusy(true);
    setWarning('');
    try {
      await sendAuthRequest('register', {
        username: form.username,
        password: form.password,
        confirm_password: form.confirmation,
        email: form.email,
        account_type: form.accountType,
      }, csrfToken);
      window.location.assign('/pages/registration-success.html');
    } catch (error) {
      setWarning(error.message);
      setBusy(false);
    }
  }

  const passwordToggle = () => setVisiblePasswords((current) => !current);

  return (
    <AuthLayout wide>
      <AuthHeader eyebrow="НАЧНИТЕ С ПРОСТОГО" title="Создать аккаунт">
        Пара деталей — и можно будет приступить к задачам.
      </AuthHeader>
      <form className="auth-form" noValidate onSubmit={handleSubmit}>
        <div className="auth-form__field">
          <label htmlFor="username">Логин</label>
          <input id="username" name="username" autoComplete="username" placeholder="Придумайте логин" value={form.username} onChange={(event) => updateField('username', event.target.value)} aria-invalid={Boolean(feedback.username)} required />
          {feedback.username && <p className="auth-form__feedback is-invalid">{feedback.username}</p>}
        </div>

        <div className="register-password-group">
          <PasswordField id="password" label="Пароль" value={form.password} onChange={(event) => updateField('password', event.target.value)} visible={visiblePasswords} onToggle={passwordToggle} autoComplete="new-password" placeholder="Придумайте пароль" hint="Не менее 6 символов." feedback={feedback.password} invalid={Boolean(feedback.password)} />
          <PasswordField id="confirmation" label="Подтвердите пароль" value={form.confirmation} onChange={(event) => updateField('confirmation', event.target.value)} visible={visiblePasswords} onToggle={passwordToggle} autoComplete="new-password" placeholder="Повторите пароль" feedback={feedback.confirmation} invalid={Boolean(feedback.confirmation)} />
        </div>

        <div className="auth-form__field">
          <label htmlFor="email">Электронная почта <span className="auth-form__optional">(опционально)</span></label>
          <input id="email" name="email" type="email" autoComplete="email" placeholder="name@example.com" value={form.email} onChange={(event) => updateField('email', event.target.value)} aria-invalid={Boolean(feedback.email)} />
          <p className="auth-form__hint">Укажите почту, если захотите восстанавливать пароль.</p>
          {feedback.email && <p className="auth-form__feedback is-invalid">{feedback.email}</p>}
        </div>

        <fieldset className="account-type">
          <legend>Для кого аккаунт?</legend>
          <div className="account-type__options">
            {[
              ['individual', '♙', 'Индивидуальный'],
              ['team', '♧', 'Для команды'],
              ['corporate', '▣', 'Корпоративный'],
            ].map(([value, icon, label]) => (
              <label className="account-type__option" key={value}>
                <input type="radio" name="account_type" value={value} checked={form.accountType === value} onChange={() => updateField('accountType', value)} />
                <span aria-hidden="true">{icon}</span>
                <span>{label}</span>
              </label>
            ))}
          </div>
          <p className="auth-form__hint auth-form__hint--warning">Командные возможности пока не подключены.</p>
        </fieldset>

        {(warning || connectionError) && <p className="auth-form__submit-warning" role="alert">{warning || connectionError}</p>}
        <button className="auth-form__submit" type="submit" disabled={!csrfToken || busy}>{busy ? 'Создаём аккаунт…' : 'Зарегистрироваться'}</button>
      </form>
      <p className="auth-card__footer">Уже есть аккаунт? <a href="/">Войти</a></p>
    </AuthLayout>
  );
}

function RecoveryPage() {
  const [message, setMessage] = useState('');
  return (
    <AuthLayout>
      <AuthHeader eyebrow="ВОССТАНОВЛЕНИЕ ДОСТУПА" title="Забыли пароль?">
        Восстановление возможно, только если при регистрации вы указали e-mail.
      </AuthHeader>
      <form className="auth-form" onSubmit={(event) => { event.preventDefault(); setMessage('Восстановление пароля пока не подключено.'); }}>
        <div className="auth-form__field">
          <label htmlFor="recovery-email">Электронная почта</label>
          <input id="recovery-email" type="email" autoComplete="email" placeholder="name@example.com" required />
        </div>
        {message && <p className="auth-form__status" role="status">{message}</p>}
        <button className="auth-form__submit" type="submit">Восстановить пароль</button>
      </form>
      <p className="auth-card__footer"><a href="/">Вернуться ко входу</a></p>
    </AuthLayout>
  );
}

function RegistrationSuccessPage() {
  return (
    <AuthLayout success>
      <AuthHeader eyebrow="ВСЁ ГОТОВО" title="Вы успешно зарегистрировались!">
        Добро пожаловать в To Do Inn!
      </AuthHeader>
      <p className="auth-form__hint auth-form__success-note">Аккаунт создан. Сервис задач пока в разработке.</p>
      <a className="auth-form__submit auth-form__submit--center" href="/pages/workspace.html">Перейти в сервис</a>
      <p className="auth-card__footer"><a href="/">Вернуться ко входу</a></p>
    </AuthLayout>
  );
}

export function AuthPages({ page }) {
  if (page === 'register') return <RegisterPage />;
  if (page === 'recovery') return <RecoveryPage />;
  if (page === 'registration-success') return <RegistrationSuccessPage />;
  return <LoginPage />;
}
