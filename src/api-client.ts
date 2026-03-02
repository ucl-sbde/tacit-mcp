/**
 * Shared API client for Tacit REST and GraphQL endpoints.
 */

const API_URL = process.env.TACIT_API_URL || "https://api.tacit.dev";
const API_KEY = process.env.TACIT_API_KEY || "";

interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; path?: string[] }>;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function handleHttpError(status: number, url: string): string {
  switch (status) {
    case 400:
      return "Bad request. Check that your query is valid and all required fields are provided.";
    case 401:
      return "Authentication failed. Check that TACIT_API_KEY is set and valid.";
    case 403:
      return "Permission denied. Your API key may not have access to this resource.";
    case 404:
      return `Resource not found at ${url}. Check the site ID or entity ID.`;
    case 429:
      return "Rate limit exceeded. Wait a moment before retrying.";
    default:
      return `API request failed with status ${status}.`;
  }
}

export async function restGet<T>(path: string): Promise<T> {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    throw new Error(handleHttpError(res.status, url));
  }
  return res.json() as Promise<T>;
}

export async function restPost<T>(path: string, body: unknown): Promise<T> {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(handleHttpError(res.status, url));
  }
  return res.json() as Promise<T>;
}

export async function graphql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const url = `${API_URL}/graphql`;
  const res = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(handleHttpError(res.status, url));
  }
  const body = (await res.json()) as GraphQLResponse<T>;
  if (body.errors?.length) {
    const msg = body.errors.map((e) => e.message).join("; ");
    throw new Error(`GraphQL error: ${msg}`);
  }
  if (!body.data) {
    throw new Error("GraphQL response contained no data.");
  }
  return body.data;
}
