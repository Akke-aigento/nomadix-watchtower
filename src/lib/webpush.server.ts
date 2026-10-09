/**
 * Web Push zonder node-crypto (werkt in Cloudflare Workers).
 *
 * - Payload-encryptie: RFC 8291 (aes128gcm, één record)
 * - Afzender-authenticatie: RFC 8292 (VAPID, ES256-JWT)
 *
 * De private VAPID-sleutel staat als JWK in private.config (nooit in de repo)
 * en wordt via de service-role-RPC get_vapid_private_jwk() gelezen.
 */

export const VAPID_PUBLIC_KEY =
  "BDD4e1jt5Bz_lCiJeh8qci66nJsLrliU2cAx0w92lyyX9wdSyitw-JS5_CbkKgMEsh01gTjVM_B1IMY3J_a3MZc";
const VAPID_SUBJECT = "mailto:info@sellqo.app";

export type PushSubscriptionRow = { endpoint: string; p256dh: string; auth: string };
export type PushPayload = { title: string; body: string; url?: string; tag?: string; severity?: string };

const enc = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;

export function b64uToBytes(s: string): Bytes {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64u(b: Uint8Array): string {
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/** RFC 8291: versleutel `plaintext` voor deze subscription. */
export async function encryptPayload(
  sub: Pick<PushSubscriptionRow, "p256dh" | "auth">,
  plaintext: Bytes,
  opts: { salt?: Bytes; ephemeral?: CryptoKeyPair } = {},
): Promise<Bytes> {
  const uaPublic = b64uToBytes(sub.p256dh);
  const authSecret = b64uToBytes(sub.auth);

  const ephemeral =
    opts.ephemeral ??
    ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, ephemeral.privateKey, 256),
  );

  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const record = concat(plaintext, new Uint8Array([2])); // 0x02 = laatste record, geen padding
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  const header = concat(salt, rs, new Uint8Array([asPublic.length]), asPublic);
  return concat(header, ciphertext);
}

/** RFC 8292: VAPID-JWT voor de push-dienst van dit endpoint. */
export async function vapidAuthorization(endpoint: string, privateJwk: JsonWebKey): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = bytesToB64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = bytesToB64u(
    enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT })),
  );
  const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${payload}`)),
  );
  return `vapid t=${header}.${payload}.${bytesToB64u(sig)}, k=${VAPID_PUBLIC_KEY}`;
}

export type SendResult = { endpoint: string; status: number; gone: boolean; error?: string };

export async function sendPush(
  sub: PushSubscriptionRow,
  payload: PushPayload,
  privateJwk: JsonWebKey,
  urgency: "high" | "normal" = "high",
): Promise<SendResult> {
  try {
    const body = await encryptPayload(sub, enc.encode(JSON.stringify(payload)));
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        authorization: await vapidAuthorization(sub.endpoint, privateJwk),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: "86400",
        urgency,
        ...(payload.tag ? { topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) } : {}),
      },
      body,
    });
    const gone = res.status === 404 || res.status === 410;
    const ok = res.status >= 200 && res.status < 300;
    return { endpoint: sub.endpoint, status: res.status, gone, error: ok ? undefined : (await res.text()).slice(0, 300) };
  } catch (e) {
    return { endpoint: sub.endpoint, status: 0, gone: false, error: e instanceof Error ? e.message : String(e) };
  }
}
