export class ApiError extends Error {
  constructor(status, { code, message, fields } = {}) {
    super(message ?? 'Terjadi kesalahan. Coba lagi.');
    this.status = status;
    this.code = code;
    this.fields = fields ?? {};
  }
}

const CONNECTION_ERROR = 'Koneksi terputus. Data Anda belum tersimpan, coba lagi.';
let onUnauthorized = () => {};

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

async function request(method, path, { json, form } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Usahaku-Client': 'web',
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: json !== undefined ? JSON.stringify(json) : form,
    });
  } catch {
    throw new ApiError(0, { code: 'NETWORK', message: CONNECTION_ERROR });
  }

  if (response.status === 204) return null;
  const isJson = response.headers.get('content-type')?.includes('application/json');
  if (!response.ok) {
    const body = isJson ? await response.json() : {};
    if (response.status === 401 && body.error?.code === 'UNAUTHORIZED') onUnauthorized();
    throw new ApiError(response.status, body.error);
  }
  return isJson ? response.json() : response;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, json = {}) => request('POST', path, { json }),
  put: (path, json) => request('PUT', path, { json }),
  del: (path) => request('DELETE', path),
  upload: (path, form) => request('POST', path, { form }),
};

export function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** Downloads a file response using the filename the server chose. */
export async function downloadFile(path) {
  const response = await request('GET', path);
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') ?? '';
  const filename = disposition.match(/filename="(.+)"/)?.[1] ?? 'unduhan';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
