let tokenProvider: (() => Promise<string | null>) | undefined;
export function setTokenProvider(provider?: () => Promise<string | null>) { tokenProvider = provider; }
export async function apiFetch(input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (tokenProvider) {
    const token = await tokenProvider();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
export async function publicToken() { return tokenProvider?.(); }
