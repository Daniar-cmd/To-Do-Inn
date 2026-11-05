import React, { useEffect, useRef, useState } from 'react';
import { getSession } from '../api.js';
import brandLogo from '../../../logos/ToDo-Inn-logo.svg';

function Brand() {
  return (
    <div className="auth-card__brand">
      <img src={brandLogo} alt="To Do Inn!" />
    </div>
  );
}

export function AuthLayout({ children, wide = false, corporateAdmin = false, success = false, finale = false }) {
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

export function AuthHeader({ eyebrow, title, children, progress }) {
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

export function PasswordField({ id, label, value, onChange, visible, onToggle, autoComplete, placeholder, hint, feedback, invalid, inputRef, onKeyDown, maxLength = 128 }) {
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

export function useCsrfToken() {
  const [csrfToken, setCsrfToken] = useState('');
  const [connectionError, setConnectionError] = useState('');

  useEffect(() => {
    getSession()
      .then((data) => setCsrfToken(data.csrf_token))
      .catch(() => setConnectionError('Не удалось подключиться к серверу. Убедитесь, что PHP и база данных запущены.'));
  }, []);

  return { csrfToken, connectionError };
}
