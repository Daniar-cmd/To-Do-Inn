// Shared UI wording. API responses and validation messages stay on the backend.
export const uiText = {
  actions: { add: 'Добавить', create: 'Создать', save: 'Сохранить', cancel: 'Отмена', delete: 'Удалить', close: 'Закрыть' },
  feedback: { loading: 'Загрузка…', saving: 'Сохраняем…', adding: 'Добавляем…', deleting: 'Удаляем…', error: 'Не удалось выполнить действие. Попробуйте ещё раз.' },
  task: {
    markImportant: 'Отметить задачу звездой', removeImportant: 'Убрать отметку важной задачи',
    showOptions: 'Показать срочность, аннотацию и локацию', hideOptions: 'Скрыть дополнительные параметры задачи',
    chooseUrgency: 'Выбрать срочность', urgency: 'Срочность', annotation: 'Аннотация', location: 'Локация', flag: 'Флаг', date: 'Дата',
    placeholder: 'Что нужно сделать?',
  },
};

export const taskUrgencyLevels = [
  { value: 1, mark: '!', label: 'Несрочно' },
  { value: 2, mark: '!!', label: 'Умеренная срочность' },
  { value: 3, mark: '!!!', label: 'Срочно' },
  { value: 4, mark: '!!!!', label: 'Критично' },
];
