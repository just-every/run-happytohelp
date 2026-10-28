// Only HubSpot provider I/O is replaced. Application requests still reach workerd.
const target = new URL(import.meta.url).searchParams.get('target');
export default async request => {
    const url = new URL(request.url);
    if (url.origin !== 'https://api.hubapi.com') throw Error('Unexpected external request');
    const destination = new URL(target);
    if (destination.hostname !== '127.0.0.1' || destination.protocol !== 'http:') throw Error('Fixture must be loopback');
    destination.pathname = url.pathname; destination.search = url.search;
    const headers = new Headers(request.headers);
    for (const key of ['content-length', 'transfer-encoding', 'connection', 'host']) headers.delete(key);
    return fetch(destination, {method: request.method, headers, body: request.method === 'GET' ? undefined : await request.arrayBuffer()});
};
