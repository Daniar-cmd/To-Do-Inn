export function usernameValidationError(username) {
  if (!username) return 'Введите логин.';
  if (/[^\x00-\x7F]/.test(username)) return 'Используйте только латинские буквы.';
  if (!/^[A-Za-z]/.test(username)) return 'Логин должен начинаться с латинской буквы.';
  if (/[^A-Za-z0-9_-]/.test(username)) return 'Разрешены латинские буквы, цифры, дефис и подчёркивание.';
  if (username.length < 3) return 'Логин вместе с @ должен содержать не менее 4 символов.';
  if (username.length > 23) return 'Логин вместе с @ должен содержать не более 24 символов.';
  return '';
}

export function createSecurePassword() {
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

export function registrationEmailWarning(accounts) {
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
