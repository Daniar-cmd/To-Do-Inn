const authEndpoint = '/api/auth.php';
const workspaceEndpoint = '/api/workspace.php';
const profileEndpoint = '/api/profile.php';
let sessionRequest = null;
const pendingListDeletions = new Map();

async function readResponse(response) {
  let result;
  try {
    result = await response.json();
  } catch {
    const error = new Error('Не удалось прочитать ответ сервера. Попробуйте позже.');
    error.status = response.status;
    throw error;
  }
  if (!response.ok || result?.success !== true) {
    const error = new Error(typeof result?.error === 'string' ? result.error : 'Не удалось выполнить запрос. Попробуйте позже.');
    error.status = response.status;
    error.isApiError = result?.success === false;
    throw error;
  }
  return result.data;
}

async function request(endpoint, { method = 'GET', data, csrfToken, signal } = {}) {
  const options = { method, credentials: 'same-origin' };
  if (signal) options.signal = signal;
  if (data !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(data);
  }
  if (csrfToken !== undefined) options.headers = { ...options.headers, 'X-CSRF-Token': csrfToken };
  return readResponse(await fetch(endpoint, options));
}

export function getSession() {
  // App and the auth form mount together. Share their initial request so a cookie-less
  // visit cannot create two sessions and pair one session's cookie with the other's CSRF token.
  // Do not cache settled responses: login/logout rotate the session and token.
  if (!sessionRequest) {
    sessionRequest = request(authEndpoint)
      .finally(() => { sessionRequest = null; });
  }
  return sessionRequest;
}

export async function getProfile() {
  return request(profileEndpoint);
}

export async function updateProfile(data, csrfToken) {
  return request(profileEndpoint, { method: 'POST', data, csrfToken });
}

export async function sendAuthRequest(action, data, csrfToken) {
  return request(authEndpoint, { method: 'POST', data: { action, ...data }, csrfToken });
}

export async function getWorkspace(boardId = null, { signal } = {}) {
  const query = boardId === null ? '' : `?${new URLSearchParams({ board_id: String(boardId) })}`;
  return request(`${workspaceEndpoint}${query}`, { signal });
}

export async function searchWorkspace(query, { signal } = {}) {
  const params = new URLSearchParams({ search: query });
  return request(`${workspaceEndpoint}?${params}`, { signal });
}

export async function createTaskList(data, csrfToken) {
  return request(workspaceEndpoint, { method: 'POST', data: { action: 'create_list', ...data }, csrfToken });
}

export async function createBoard(data, csrfToken) {
  return request(workspaceEndpoint, { method: 'POST', data: { action: 'create_board', ...data }, csrfToken });
}

export async function deleteBoard(boardId, csrfToken) {
  const query = new URLSearchParams({ board_id: String(boardId) });
  return request(`${workspaceEndpoint}?${query}`, { method: 'DELETE', csrfToken });
}

export async function updateWorkspace(data, csrfToken) {
  return request(workspaceEndpoint, { method: 'POST', data, csrfToken });
}

export function deleteTaskList(listId, csrfToken) {
  const key = `${csrfToken}:${listId}`;
  if (pendingListDeletions.has(key)) return pendingListDeletions.get(key);
  const query = new URLSearchParams({ list_id: String(listId) });
  const deletion = request(`${workspaceEndpoint}?${query}`, { method: 'DELETE', csrfToken })
    .finally(() => pendingListDeletions.delete(key));
  pendingListDeletions.set(key, deletion);
  return deletion;
}
