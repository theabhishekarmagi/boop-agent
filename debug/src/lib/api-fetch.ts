import { authClient } from "./auth-client";

export async function sessionToken(): Promise<string> {
  const { data } = await authClient.convex.token();
  if (!data?.token) throw new Error("Please sign in again");
  return data.token;
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await sessionToken()}`);
  return fetch(input, { ...init, headers });
}
