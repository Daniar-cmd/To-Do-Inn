import React, { useEffect, useState } from 'react';
import { getSession, sendAuthRequest } from '../api.js';
import { NotificationsMenu } from '../NotificationsMenu.jsx';
import { AuthHeader, AuthLayout, useCsrfToken } from './AuthCommon.jsx';

export function OrganizationRootPage() {
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
