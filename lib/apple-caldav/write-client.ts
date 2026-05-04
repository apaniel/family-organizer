import 'server-only';

import { createCalendarObject, deleteCalendarObject, updateCalendarObject } from 'tsdav';

export class CalDAVETagMismatchError extends Error {
    readonly code = 'etag_mismatch';
    readonly status = 412;
    constructor(message = 'Remote calendar resource changed since last sync') {
        super(message);
        this.name = 'CalDAVETagMismatchError';
    }
}

export class CalDAVNotFoundError extends Error {
    readonly code = 'not_found';
    readonly status = 404;
    constructor(message = 'Remote calendar resource not found') {
        super(message);
        this.name = 'CalDAVNotFoundError';
    }
}

export class CalDAVUidConflictError extends Error {
    readonly code = 'uid_conflict';
    readonly status = 409;
    constructor(message = 'A calendar resource with this UID already exists') {
        super(message);
        this.name = 'CalDAVUidConflictError';
    }
}

function basicAuthHeader(username: string, password: string) {
    const token = Buffer.from(`${username}:${password}`).toString('base64');
    return { Authorization: `Basic ${token}` };
}

function ensureTrailingSlash(url: string) {
    return url.endsWith('/') ? url : `${url}/`;
}

function extractEtag(response: Response) {
    const value = response.headers.get('etag') || response.headers.get('ETag') || '';
    return value.trim();
}

async function failureFor(response: Response, defaultMessage: string): Promise<Error> {
    let body = '';
    try {
        body = await response.text();
    } catch {}
    const error = new Error(`${defaultMessage} (${response.status})`);
    (error as any).status = response.status;
    (error as any).body = body.slice(0, 400);
    return error;
}

export async function createAppleCalendarObject(input: {
    username: string;
    password: string;
    calendarUrl: string;
    ics: string;
    uid: string;
}): Promise<{ url: string; etag: string }> {
    const filename = `${input.uid}.ics`;
    const calendarUrl = ensureTrailingSlash(input.calendarUrl);
    const response = await createCalendarObject({
        calendar: { url: calendarUrl } as any,
        iCalString: input.ics,
        filename,
        headers: basicAuthHeader(input.username, input.password),
    });

    if (response.status === 412 || response.status === 409) {
        throw new CalDAVUidConflictError();
    }
    if (!response.ok) {
        throw await failureFor(response, 'CalDAV create failed');
    }

    return {
        url: new URL(filename, calendarUrl).toString(),
        etag: extractEtag(response),
    };
}

export async function updateAppleCalendarObject(input: {
    username: string;
    password: string;
    url: string;
    ics: string;
    etag: string;
}): Promise<{ etag: string }> {
    if (!input.etag) {
        throw new Error('updateAppleCalendarObject requires a non-empty etag for safe writes');
    }
    const response = await updateCalendarObject({
        calendarObject: { url: input.url, data: input.ics, etag: input.etag },
        headers: basicAuthHeader(input.username, input.password),
    });

    if (response.status === 412) throw new CalDAVETagMismatchError();
    if (response.status === 404) throw new CalDAVNotFoundError();
    if (!response.ok) throw await failureFor(response, 'CalDAV update failed');

    return { etag: extractEtag(response) };
}

export async function deleteAppleCalendarObject(input: {
    username: string;
    password: string;
    url: string;
    etag: string;
}): Promise<{ alreadyDeleted: boolean }> {
    if (!input.etag) {
        throw new Error('deleteAppleCalendarObject requires a non-empty etag for safe writes');
    }
    const response = await deleteCalendarObject({
        calendarObject: { url: input.url, etag: input.etag },
        headers: basicAuthHeader(input.username, input.password),
    });

    if (response.status === 404) return { alreadyDeleted: true };
    if (response.status === 412) throw new CalDAVETagMismatchError();
    if (!response.ok) throw await failureFor(response, 'CalDAV delete failed');

    return { alreadyDeleted: false };
}
