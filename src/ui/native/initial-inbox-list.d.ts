import type {InitialReadOutcome} from './dashboard-bootstrap';
export type InboxListSearch = Partial<Record<'view' | 'q' | 'tag' | 'assigned_to' | 'search_scope' | 'saved_view' | 'filters' | 'sort' | 'snoozed', string>>;
export type InitialInboxListData = {
    projectId?: string;
    filter: Record<string,string>;
    outcome: Promise<InitialReadOutcome>;
};
export function initialInboxListFilter(search?: InboxListSearch, counts?: any): Record<string,string>;
export interface InitialInboxList {
    id: string;
    expire(): void;
    take(params: Record<string,unknown>, scope: {
        projectId?: string; path: string; search: string;
        signal?: AbortSignal; isCurrent(): boolean;
    }): Promise<{result: any} | undefined>;
}
export function createInitialInboxList(raw: InitialInboxListData | undefined, location: {
    pathname: string; searchStr: string;
}): InitialInboxList | undefined;
