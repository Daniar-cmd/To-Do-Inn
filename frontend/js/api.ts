const authEndpoint = '/api/auth.php';
const workspaceEndpoint = '/api/workspace.php';
const profileEndpoint = '/api/profile.php';
type ApiError = Error & { status?: number; isApiError?: boolean };
type RequestOptions = { method?: string; data?: Record<string, unknown>; csrfToken?: string; signal?: AbortSignal };
let sessionRequest: Promise<any> | null = null;
const pendingListDeletions = new Map<string, Promise<any>>();

async function readResponse(response: Response) {
  let result;
  try {
    result = await response.json();
  } catch {
    const error: ApiError = new Error('Не удалось прочитать ответ сервера. Попробуйте позже.');
    error.status = response.status;
    throw error;
  }
  if (!response.ok || result?.success !== true) {
    const error: ApiError = new Error(typeof result?.error === 'string' ? result.error : 'Не удалось выполнить запрос. Попробуйте позже.');
    error.status = response.status;
    error.isApiError = result?.success === false;
    throw error;
  }
  return result.data;
}

async function request(endpoint: string, { method = 'GET', data, csrfToken, signal }: RequestOptions = {}) {
  const options: RequestInit = { method, credentials: 'same-origin' };
  if (signal) options.signal = signal;
  if (data !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(data);
  }
  if (csrfToken !== undefined) options.headers = { ...options.headers, 'X-CSRF-Token': csrfToken };
  const response = await fetch(endpoint, options);
  if (response.status === 401 && typeof window !== 'undefined'
      && window.location.pathname === '/pages/workspace.html') {
    window.location.replace('/');
  }
  return readResponse(response);
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

export async function updateProfile(data: Record<string, unknown>, csrfToken: string) {
  return request(profileEndpoint, { method: 'POST', data, csrfToken });
}

export async function sendAuthRequest(action: string, data: Record<string, unknown>, csrfToken: string) {
  return request(authEndpoint, { method: 'POST', data: { action, ...data }, csrfToken });
}

export async function getWorkspace(boardId: number | string | null = null, { signal }: { signal?: AbortSignal } = {}) {
  const query = boardId === null ? '' : `?${new URLSearchParams({ board_id: String(boardId) })}`;
  return request(`${workspaceEndpoint}${query}`, { signal });
}

export async function searchWorkspace(query: string, { signal }: { signal?: AbortSignal } = {}) {
  const params = new URLSearchParams({ search: query });
  return request(`${workspaceEndpoint}?${params}`, { signal });
}

export async function createTaskList(data: Record<string, unknown>, csrfToken: string) {
  return request(workspaceEndpoint, { method: 'POST', data: { action: 'create_list', ...data }, csrfToken });
}

export async function createWorkspaceNote(data: Record<string, unknown>, csrfToken: string) {
  return request(workspaceEndpoint, { method: 'POST', data: { action: 'create_note', ...data }, csrfToken });
}

export async function uploadNoteImage(noteId: number | string, file: File, offset: number, csrfToken: string) {
  const data = new FormData();
  data.append('image', file);
  data.append('offset', String(offset));
  const response = await fetch(`/api/notes/${noteId}/image`, {
    method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrfToken }, body: data,
  });
  return readResponse(response);
}

export async function removeNoteImage(noteId: number | string, csrfToken: string) {
  const response = await fetch(`/api/notes/${noteId}/image`, {
    method: 'DELETE', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrfToken },
  });
  return readResponse(response);
}

export async function createBoard(data: Record<string, unknown>, csrfToken: string) {
  return request(workspaceEndpoint, { method: 'POST', data: { action: 'create_board', ...data }, csrfToken });
}

export async function deleteBoard(boardId: number | string, csrfToken: string) {
  const query = new URLSearchParams({ board_id: String(boardId) });
  return request(`${workspaceEndpoint}?${query}`, { method: 'DELETE', csrfToken });
}

export async function updateWorkspace(data: Record<string, unknown>, csrfToken: string) {
  return request(workspaceEndpoint, { method: 'POST', data, csrfToken });
}

export function deleteTaskList(listId: number | string, csrfToken: string) {
  const key = `${csrfToken}:${listId}`;
  if (pendingListDeletions.has(key)) return pendingListDeletions.get(key);
  const query = new URLSearchParams({ list_id: String(listId) });
  const deletion = request(`${workspaceEndpoint}?${query}`, { method: 'DELETE', csrfToken })
    .finally(() => pendingListDeletions.delete(key));
  pendingListDeletions.set(key, deletion);
  return deletion;
}
