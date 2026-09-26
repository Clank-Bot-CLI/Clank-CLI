import { createSiweMessage } from "viem/siwe";
import { API_ORIGIN } from "./chain.js";

const AUTH = `${API_ORIGIN}/v1/auth`;

function storeCookies(jar, response) {
  const lines =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  for (const line of lines) {
    const pair = line.split(";")[0];
    const cut = pair.indexOf("=");
    if (cut > 0) jar.set(pair.slice(0, cut), pair.slice(cut + 1));
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function authFetch(jar, url, { method = "GET", json, body, contentType } = {}) {
  const headers = {
    origin: API_ORIGIN,
    referer: `${API_ORIGIN}/create`,
  };
  const cookie = cookieHeader(jar);
  if (cookie) headers.cookie = cookie;
  let payload = body;
  if (json !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(json);
  } else if (contentType) {
    headers["content-type"] = contentType;
  }
  const response = await fetch(url, { method, headers, body: payload });
  storeCookies(jar, response);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const message =
      data && typeof data === "object"
        ? data.message || data.error || JSON.stringify(data)
        : text || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

export async function signIn(account) {
  const jar = new Map();
  const config = await authFetch(jar, `${API_ORIGIN}/v1/auth-config`);
  const { nonce } = await authFetch(jar, `${AUTH}/siwe/nonce`, {
    method: "POST",
    json: {},
  });
  if (!nonce) throw new Error("Could not get a sign-in nonce.");

  const message = createSiweMessage({
    address: account.address,
    chainId: config.chainId,
    domain: config.domain,
    uri: config.uri,
    nonce,
    version: "1",
    statement: "Sign in to Clank Trade.",
    issuedAt: new Date(),
    expirationTime: new Date(Date.now() + 5 * 60 * 1000),
  });
  const signature = await account.signMessage({ message });
  const verified = await authFetch(jar, `${AUTH}/siwe/verify`, {
    method: "POST",
    json: { message, signature },
  });
  const session = await authFetch(jar, `${API_ORIGIN}/v1/session`);
  if (!session?.address || session.address.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error("Sign-in session does not match this wallet.");
  }
  return { jar, session, token: verified?.token };
}

export async function uploadImage(jar, bytes, contentType) {
  const data = await authFetch(jar, `${API_ORIGIN}/v1/images`, {
    method: "POST",
    body: bytes,
    contentType,
  });
  if (!data?.url || typeof data.url !== "string") {
    throw new Error("The server did not return an image URL.");
  }
  return data.url;
}
