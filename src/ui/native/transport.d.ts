export function nativeRequest(path: string, init?: RequestInit): Promise<any>;
export function sendCommand(projectId: string, conversationId: string, action: string, data: any): Promise<any>;
export function connectConversation(conversationId: string, onFrame: (frame: any) => void, onReconnect: () => void, onError: (error: Error) => void): (() => void) & {send: (frame: any) => boolean};
export function connectProject(projectId: string, onFrame: (frame: any) => void, onReconnect: () => void, onError: (error: Error) => void): (() => void) & {send: (frame: any) => boolean};
export function confirmStepUp(details: unknown): Promise<boolean>;
export function downloadFile(path: string): Promise<void>;
