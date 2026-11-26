// Browser side of WebAuthn: the server's JSON options become the binary shapes
// navigator.credentials expects, and the credential comes back as base64url JSON.
const toBytes = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), char => char.charCodeAt(0));
const toText = (buffer: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const passkeysAvailable = () => typeof window !== 'undefined' && Boolean(window.PublicKeyCredential) && Boolean(navigator.credentials);
/** Passkeys bind to a domain name; an address such as 127.0.0.1 cannot hold one. */
export const passkeyDomain = () => typeof location !== 'undefined' && !/^\d+\.\d+\.\d+\.\d+$|^\[/.test(location.hostname);
/** A local copy served on a loopback address, such as one set up before rer dev defaulted to localhost. */
export const loopbackAddress = () => typeof location !== 'undefined' && /^127\.\d+\.\d+\.\d+$|^\[::1\]$/.test(location.hostname);

export async function createPasskey(options: any) {
    const publicKey = { ...options.publicKey, challenge: toBytes(options.publicKey.challenge), user: { ...options.publicKey.user, id: toBytes(options.publicKey.user.id) },
        excludeCredentials: options.publicKey.excludeCredentials.map((item: any) => ({ ...item, id: toBytes(item.id) })) };
    const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential | null;
    if (!credential) throw new Error('No security key or passkey was created.');
    const response = credential.response as AuthenticatorAttestationResponse;
    return { id: credential.id, type: credential.type, response: { clientDataJSON: toText(response.clientDataJSON), attestationObject: toText(response.attestationObject) } };
}

export async function assertPasskey(options: any) {
    const publicKey = { ...options.publicKey, challenge: toBytes(options.publicKey.challenge), allowCredentials: options.publicKey.allowCredentials.map((item: any) => ({ ...item, id: toBytes(item.id) })) };
    const credential = await navigator.credentials.get({ publicKey }) as PublicKeyCredential | null;
    if (!credential) throw new Error('No passkey was used.');
    const response = credential.response as AuthenticatorAssertionResponse;
    return { id: credential.id, type: credential.type, response: { clientDataJSON: toText(response.clientDataJSON), authenticatorData: toText(response.authenticatorData), signature: toText(response.signature) } };
}
