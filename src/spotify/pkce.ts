export async function createCodeVerifier(): Promise<string> {
  const values = crypto.getRandomValues(new Uint8Array(64));
  return base64Url(values);
}

export async function createCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  const raw = String.fromCharCode(...bytes);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
