// Wire contract shared with Xiaowo's Worker. No client values are authority.
const HEX = /^[a-f0-9]{64}$/;
export const evidenceKeyValid = (key) => typeof key === 'string' && HEX.test(key);
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function mac(key, value) {
  if (!evidenceKeyValid(key)) throw Error('evidence configuration unavailable');
  const bytes = Uint8Array.from(key.match(/../g), (b) => parseInt(b, 16));
  const imported = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', imported, new TextEncoder().encode(canonical(value))))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function signEvidence(data, purpose, key, now = new Date()) {
  const proof = { version: 1, issuer: 'xiaowo-owner', audience: 'xinchao-shadow', purpose,
    authorization: 'owner_bearer_report', issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 300_000).toISOString(), data };
  return { ...proof, signature: await mac(key, proof) };
}
export async function verifyEvidence(envelope, purpose, key, now = new Date()) {
  if (!evidenceKeyValid(key) || !envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return false;
  const fields = ['version', 'issuer', 'audience', 'purpose', 'authorization', 'issued_at', 'expires_at', 'data', 'signature'];
  if (Object.keys(envelope).length !== fields.length || fields.some((k) => !Object.hasOwn(envelope, k))) return false;
  if (envelope.version !== 1 || envelope.issuer !== 'xiaowo-owner' || envelope.audience !== 'xinchao-shadow' ||
      envelope.purpose !== purpose || envelope.authorization !== 'owner_bearer_report' || !HEX.test(envelope.signature)) return false;
  const issued = Date.parse(envelope.issued_at), expires = Date.parse(envelope.expires_at);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || new Date(issued).toISOString() !== envelope.issued_at ||
      new Date(expires).toISOString() !== envelope.expires_at || issued > now.getTime() ||
      expires - issued !== 300_000 || now.getTime() >= expires) return false;
  const { signature, ...proof } = envelope;
  const bytes = Uint8Array.from(key.match(/../g), (b) => parseInt(b, 16));
  const imported = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', imported, Uint8Array.from(signature.match(/../g), (b) => parseInt(b, 16)), new TextEncoder().encode(canonical(proof)));
}
