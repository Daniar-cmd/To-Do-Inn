import React, { useEffect, useState } from 'react';
import { getSession, sendAuthRequest } from '../api.ts';
import { NotificationsMenu } from '../NotificationsMenu.tsx';
import type { Notification } from '../NotificationsMenu.tsx';
import { AuthHeader, AuthLayout, useCsrfToken } from './AuthCommon.tsx';

export function OrganizationRootPage() {
  const { csrfToken, connectionError } = useCsrfToken();
  const [message, setMessage] = useState('');
  const [organization, setOrganization] = useState<{ avatar: string | null; name: string; description: string | null; secondary_email: string | null; github_url: string | null; telegram_url: string | null; preferred_theme: string } | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationError, setNotificationError] = useState('');
  const [notificationBusyId, setNotificationBusyId] = useState<number | null>(null);

  useEffect(() => {
    getSession().then(({ corporate_account: account }) => setOrganization(account || null)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!csrfToken) return undefined;
    let active = true;
    sendAuthRequest('get_notifications', {}, csrfToken)
      .then((data) => { if (active) setNotifications(data.notifications || []); })
      .catch((error) => { if (active) setNotificationError((error as Error).message); });
    return () => { active = false; };
  }, [csrfToken]);

  async function markNotificationRead(notification: Notification) {
    if (notification.is_read || notificationBusyId !== null) return;
    setNotificationBusyId(notification.id);
    setNotificationError('');
    try {
      await sendAuthRequest('mark_notification_read', { notification_id: notification.id }, csrfToken);
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, is_read: true } : item));
    } catch (error) {
      setNotificationError((error as Error).message);
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
      setMessage((error as Error).message);
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
