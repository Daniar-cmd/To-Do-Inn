import React, { useEffect, useState } from 'react';
import { AuthPages } from './auth/AuthPages.jsx';
import { Workspace } from './workspace/Workspace.jsx';
import { getSession } from './api.js';

const routes = {
  '/': 'login',
  '/pages/register.html': 'register',
  '/pages/forgot-password.html': 'recovery',
  '/pages/registration-success.html': 'registration-success',
  '/pages/corporate-invitation.html': 'corporate-invitation',
  '/pages/organization-root.html': 'organization-root',
  '/pages/workspace.html': 'workspace',
};

export function App() {
  const route = routes[window.location.pathname] || 'login';
  const upgradingLegacyAccount = route === 'register'
    && new URLSearchParams(window.location.search).get('upgrade') === '1';
  const [redirecting, setRedirecting] = useState(route === 'workspace');

  useEffect(() => {
    if (route === 'workspace') return;

    getSession()
      .then(({ user, corporate_account: corporateAccount }) => {
        if (corporateAccount && route !== 'organization-root') {
          window.location.replace('/pages/organization-root.html');
        } else if (upgradingLegacyAccount && !user) {
          window.location.replace('/');
        } else if (route === 'organization-root' && !corporateAccount) {
          window.location.replace('/');
        } else if (user && route !== 'registration-success' && route !== 'corporate-invitation' && !upgradingLegacyAccount) {
          window.location.replace('/pages/workspace.html');
        } else if (route === 'registration-success' && !user && !new URLSearchParams(window.location.search).has('corporate')) {
          window.location.replace('/');
        } else {
          setRedirecting(false);
        }
      })
      .catch(() => setRedirecting(false));
  }, [route]);

  useEffect(() => {
    const titles = {
      login: 'Вход — To Do Inn!',
      register: 'Регистрация — To Do Inn!',
      recovery: 'Восстановление пароля — To Do Inn!',
      'registration-success': 'Регистрация — To Do Inn!',
      'corporate-invitation': 'Приглашение — To Do Inn!',
      'organization-root': 'Организация — To Do Inn!',
      workspace: 'Рабочее пространство — To Do Inn!',
    };
    document.title = titles[route] || titles.login;
  }, [route]);

  const screen = route === 'workspace'
    ? <Workspace />
    : redirecting
      ? <div className="app-loading" role="status">Загрузка…</div>
      : <AuthPages page={route} />;

  return (
    <>
      {screen}
      {import.meta.env.DEV && <div className="development-badge">Тестовая версия</div>}
    </>
  );
}
