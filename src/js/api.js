const authEndpoint = '/api/auth.php';
const workspaceEndpoint = '/api/workspace.php';
const profileEndpoint = '/api/profile.php';

async function readResponse(response) {
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Не удалось выполнить запрос. Попробуйте позже.');
  }
  return result.data;
}

export async function getSession() {
  return readResponse(await fetch(authEndpoint, { credentials: 'same-origin' }));
}

export async function getProfile() {
  return readResponse(await fetch(profileEndpoint, { credentials: 'same-origin' }));
}

export async function updateProfile(data, csrfToken) {
  return readResponse(await fetch(profileEndpoint, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify(data),
  }));
}

export async function sendAuthRequest(action, data, csrfToken) {
  return readResponse(await fetch(authEndpoint, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ action, ...data }),
  }));
}

export async function getWorkspace(boardId = null) {
  const query = boardId === null ? '' : `?${new URLSearchParams({ board_id: String(boardId) })}`;
  return readResponse(await fetch(`${workspaceEndpoint}${query}`, { credentials: 'same-origin' }));
}

export async function searchWorkspace(query) {
  const params = new URLSearchParams({ search: query });
  return readResponse(await fetch(`${workspaceEndpoint}?${params}`, { credentials: 'same-origin' }));
}

export async function createTaskList(data, csrfToken) {
  return readResponse(await fetch(workspaceEndpoint, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ action: 'create_list', ...data }),
  }));
}

export async function createBoard(data, csrfToken) {
  return readResponse(await fetch(workspaceEndpoint, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ action: 'create_board', ...data }),
  }));
}

export async function deleteBoard(boardId, csrfToken) {
  const query = new URLSearchParams({ board_id: String(boardId) });
  return readResponse(await fetch(`${workspaceEndpoint}?${query}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrfToken },
  }));
}

export async function updateWorkspace(data, csrfToken) {
  return readResponse(await fetch(workspaceEndpoint, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(data),
  }));
}

export async function deleteTaskList(listId, csrfToken) {
  const query = new URLSearchParams({ list_id: String(listId) });
  return readResponse(await fetch(`${workspaceEndpoint}?${query}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrfToken },
  }));
}
