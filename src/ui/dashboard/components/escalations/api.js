import {nativeRequest} from '../../../native/transport';

export const providerNames = {github: 'GitHub', linear: 'Linear', jira: 'Jira', slack: 'Slack'};

export async function escalationRead(path) {
    return (await nativeRequest(path)).data;
}

export async function escalationWrite(path, body) {
    return (await nativeRequest(path, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
    })).data;
}
