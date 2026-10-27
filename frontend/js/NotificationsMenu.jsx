import React from 'react';

function formatNotificationDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export function NotificationsMenu({ notifications, unreadCount, onRead, busyId = null, error = '' }) {
  return (
    <details className="notifications-menu">
      <summary className="notifications-menu__trigger" aria-label={`Открыть уведомления${unreadCount ? `, непрочитанных: ${unreadCount}` : ''}`} title="Уведомления">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>
        {unreadCount > 0 && <span className="notifications-menu__badge" aria-label={`${unreadCount} непрочитанных уведомлений`} />}
      </summary>
      <div className="notifications-menu__panel" aria-label="Список уведомлений">
        {error && <p className="notifications-menu__error" role="alert">{error}</p>}
        {notifications.length === 0
          ? <p className="notifications-menu__empty">Уведомлений нет!</p>
          : <ul>{notifications.map((notification) => <li className={`notifications-menu__item${notification.is_read ? ' is-read' : ''}`} key={notification.id}>
            <div className="notifications-menu__heading"><strong>{notification.sender}</strong><time dateTime={notification.created_at}>{formatNotificationDate(notification.created_at)}</time></div>
            <p>{notification.message}</p>
            <button type="button" onClick={() => onRead(notification)} disabled={notification.is_read || busyId === notification.id}>
              {notification.is_read ? 'Прочитано' : busyId === notification.id ? 'Сохраняем…' : 'Прочитано'}
            </button>
          </li>)}</ul>}
      </div>
    </details>
  );
}
