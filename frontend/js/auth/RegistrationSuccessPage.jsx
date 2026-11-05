import React, { useEffect, useState } from 'react';
import { AuthLayout } from './AuthCommon.jsx';

export function RegistrationSuccessPage() {
  const corporateCreated = new URLSearchParams(window.location.search).get('corporate') === 'created';
  const accountUpgraded = new URLSearchParams(window.location.search).get('upgraded') === '1';
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
            <p className="registration-finale__eyebrow">{accountUpgraded ? 'АККАУНТ УСПЕШНО ОБНОВЛЁН' : 'Регистрация успешно завершена'}</p>
            <h1>{accountUpgraded ? 'Готово, данные обновлены!' : corporateCreated ? 'Всё готово!' : `Добро пожаловать${welcome ? `, ${welcome}` : ''}!`}</h1>
            <p className="registration-finale__description">{accountUpgraded
              ? 'Ваше рабочее пространство готово. Доски, списки и задачи сохранены.'
              : corporateCreated
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
