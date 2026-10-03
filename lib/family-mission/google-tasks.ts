import 'server-only';

const OWNERS = ['Dani', 'Cris', 'Saida', 'Familia'];
const TASKS = 'https://tasks.googleapis.com/tasks/v1';
const CALENDAR = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent('losapalas@gmail.com') + '/events';
const EVENT_MINUTES = 30;
const UNASSIGNED = 'Responsable (Dashboard): Sin asignar';
export class GoogleTasksConflict extends Error {
    constructor(message: string, public status: number | null = null) {
        super(message);
    }
}
export class GoogleTasksUnconfirmed extends Error {
    constructor(message: string, public status: number | null = null) {
        super(message);
    }
}
type Resource = {
    id: string;
    title?: string;
    notes?: string;
    due?: string;
    status?: string;
    completed?: string;
    updated?: string;
    webViewLink?: string;
    etag?: string;
    deleted?: boolean;
};
type Located = { raw: Resource; owner: string; listId: string };
export type TaskInput = {
    id?: string;
    revision?: number;
    title: string;
    notes: string;
    owner: string;
    date?: string;
    time?: string;
    status: 'open' | 'waiting' | 'done';
    category?: string;
    reminderDays?: number;
    sourceKey?: string;
    source?: string;
};
type Json = Record<string, unknown>;
function taskStatus(raw: Resource, meta: URLSearchParams): TaskInput['status'] {
    return raw.status === 'completed' ? 'done' : meta.get('estado') === 'esperando' ? 'waiting' : 'open';
}
function object(value: unknown): Json {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Google response');
    return value as Json;
}
function resource(value: unknown): Resource {
    const r = object(value);
    if (typeof r.id !== 'string') throw new Error('Invalid Google task');
    for (const k of ['title', 'notes', 'due', 'status', 'completed', 'updated', 'webViewLink', 'etag'])
        if (r[k] !== undefined && r[k] !== null && typeof r[k] !== 'string') throw new Error('Invalid Google task');
    return Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)) as Resource;
}
let cachedToken: { value: string; expires: number } | undefined;
let pendingRefresh: Promise<string> | undefined;
async function token() {
    const cached = cachedToken;
    if (cached && cached.expires > Date.now()) return cached.value;
    const pending = pendingRefresh;
    if (pending) return pending;
    const refresh = (async () => {
        const client_id = process.env.GOOGLE_TASKS_CLIENT_ID,
            client_secret = process.env.GOOGLE_TASKS_CLIENT_SECRET,
            refresh_token = process.env.GOOGLE_TASKS_REFRESH_TOKEN;
        if (!client_id || !client_secret || !refresh_token) throw new Error('Google credentials incomplete');
        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id, client_secret, refresh_token, grant_type: 'refresh_token' }),
            cache: 'no-store',
            signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw new ApiError(response.status, 'authorization');
        const body = object(await response.json());
        if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') throw new Error('Invalid Google authorization response');
        cachedToken = { value: body.access_token, expires: Date.now() + (body.expires_in - 60) * 1000 };
        return body.access_token;
    })();
    pendingRefresh = refresh;
    try {
        return await refresh;
    } finally {
        pendingRefresh = undefined;
    }
}
class ApiError extends Error {
    constructor(public status: number, public reason: string) {
        super('Google Tasks unavailable');
    }
}
type Step = 'tasks-read' | 'tasks-insert' | 'tasks-patch' | 'tasks-delete' | 'calendar-get' | 'calendar-insert' | 'calendar-patch' | 'calendar-delete' | 'readback';
function errorStatus(error: unknown) {
    return error instanceof ApiError || error instanceof GoogleTasksUnconfirmed || error instanceof GoogleTasksConflict ? error.status : null;
}
class Session {
    step: Step | null = null;
    written = false;
    mutations = 0;
    async call(url: string, method = 'GET', body?: unknown, etag?: string, step?: 'readback'): Promise<Json | null> {
        const calendar = url.startsWith(CALENDAR);
        this.step = step ?? (
            method === 'GET' ? (calendar ? 'calendar-get' : 'tasks-read') :
            method === 'POST' ? (calendar ? 'calendar-insert' : 'tasks-insert') :
            method === 'DELETE' ? (calendar ? 'calendar-delete' : 'tasks-delete') :
            (calendar ? 'calendar-patch' : 'tasks-patch')
        );
        const access = await token();
        const writing = method !== 'GET';
        if (writing) this.written = true;
        try {
            const response = await fetch(url, {
                method,
                headers: { Authorization: `Bearer ${access}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(etag ? { 'If-Match': etag } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {}),
                cache: 'no-store',
                signal: AbortSignal.timeout(20000),
            });
            if (response.status === 410 && method === 'GET' && url.startsWith(CALENDAR)) return { status: 'cancelled' };
            if (response.status === 404 || response.status === 410) return null;
            if (response.status === 412) throw new GoogleTasksConflict('La tarea ha cambiado. Actualiza la página.', response.status);
            if (!response.ok) throw new ApiError(response.status, response.status >= 500 ? 'server' : 'rejected');
            if (writing) this.mutations++;
            return response.status === 204 ? {} : object(await response.json());
        } catch (error) {
            if (error instanceof GoogleTasksConflict) throw error;
            if (this.written && (!(error instanceof ApiError) || error.status >= 500))
                throw new GoogleTasksUnconfirmed('Google no ha confirmado la operación.', error instanceof ApiError ? error.status : null);
            throw error;
        }
    }
    async pages(url: string): Promise<Json[]> {
        const items: Json[] = [];
        let pageToken = '';
        do {
            const u = new URL(url);
            if (pageToken) u.searchParams.set('pageToken', pageToken);
            const p = await this.call(u.toString());
            if (!p) throw new Error('Google list missing');
            if (p.items !== undefined && !Array.isArray(p.items)) throw new Error('Invalid Google page');
            items.push(...(Array.isArray(p.items) ? p.items.map(object) : []));
            pageToken = typeof p.nextPageToken === 'string' ? p.nextPageToken : '';
        } while (pageToken);
        return items;
    }
    async lists() {
        const items = await this.pages(TASKS + '/users/@me/lists?maxResults=100');
        return new Map(items.filter((x) => typeof x.title === 'string' && typeof x.id === 'string').map((x) => [String(x.title), String(x.id)]));
    }
    async all(): Promise<Located[]> {
        const lists = await this.lists(),
            out: Located[] = [];
        for (const owner of OWNERS) {
            const listId = lists.get(owner);
            if (!listId) continue;
            for (const raw of await this.pages(TASKS + '/lists/' + encodeURIComponent(listId) + '/tasks?maxResults=100&showCompleted=true&showHidden=true'))
                if (!raw.deleted) out.push({ raw: resource(raw), owner, listId });
        }
        return out;
    }
}
function split(notes = '') {
    const lines = notes.replace(/\n+$/, '').split('\n'),
        last = lines.at(-1) || '';
    if (last.startsWith('#hermes '))
        return {
            notes: lines.slice(0, -1).join('\n').trimEnd(),
            meta: new URLSearchParams(
                Array.from(new URLSearchParams(last.slice(8)).entries()).filter(([key]) => ['key', 'cat', 'estado', 'hora', 'aviso', 'evento'].includes(key))
            ),
        };
    return { notes: notes.trimEnd(), meta: new URLSearchParams() };
}
function join(notes: string, meta: URLSearchParams) {
    meta.sort();
    return notes.trimEnd() + (meta.size ? (notes.trimEnd() ? '\n\n' : '') + '#hermes ' + meta.toString() : '');
}
async function hash(value: string) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('');
}
async function record(t: Located) {
    const { notes, meta } = split(t.raw.notes);
    const unassigned = t.owner === 'Familia' && (notes === UNASSIGNED || notes.endsWith('\n' + UNASSIGNED));
    return {
        kind: 'task',
        id: t.raw.id,
        title: t.raw.title || '',
        date: t.raw.due?.slice(0, 10) || '',
        endDate: '',
        time: meta.get('hora') || '',
        endTime: '',
        owner: unassigned ? 'Sin asignar' : t.owner,
        status: taskStatus(t.raw, meta),
        category: meta.get('cat') || '',
        notes: unassigned ? notes.slice(0, -UNASSIGNED.length).replace(/\n$/, '') : notes,
        checklist: [],
        audience: 'adults',
        recurrence: 'none',
        confirmed: true,
        reminderDays: /^\d+$/.test(meta.get('aviso') || '') ? Number(meta.get('aviso')) : 0,
        sourceKey: meta.get('key'),
        updatedAt: t.raw.updated ?? null,
        completedAt: t.raw.completed ?? null,
        eventId: meta.get('evento'),
        webViewLink: t.raw.webViewLink ?? null,
        store: 'google-tasks',
        revision: parseInt((await hash(t.raw.updated || '')).slice(0, 13), 16),
        slot: 'dinner',
        source: 'Google Tasks',
    };
}
export type GoogleTaskRecord = Awaited<ReturnType<typeof record>>;
let cache: { records: GoogleTaskRecord[]; expires: number } | undefined;
let generation = 0;
function invalidate() {
    cache = undefined;
    generation++;
}
async function report<T>(phase: string, session: Session, run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (e) {
        console.error(
            JSON.stringify({
                event: 'google_tasks_error',
                phase,
                step: session.step,
                status: errorStatus(e),
                reason:
                    e instanceof GoogleTasksConflict
                        ? 'conflict'
                        : e instanceof GoogleTasksUnconfirmed
                        ? 'unconfirmed'
                        : e instanceof ApiError
                        ? e.reason
                        : 'unavailable',
            })
        );
        throw e;
    }
}
export async function listTasks() {
    const s = new Session();
    return report('list', s, async () => {
        if (cache && cache.expires > Date.now()) return structuredClone(cache.records);
        const stamp = generation;
        const records = await Promise.all((await s.all()).map(record));
        records.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
        if (stamp === generation) cache = { records, expires: Date.now() + 15000 };
        return structuredClone(records);
    });
}
function path(t: Located) {
    return TASKS + '/lists/' + encodeURIComponent(t.listId) + '/tasks/' + encodeURIComponent(t.raw.id);
}
async function patch(s: Session, t: Located, body: Json) {
    const raw = await s.call(path(t), 'PATCH', body, t.raw.etag);
    if (!raw) throw new GoogleTasksConflict('La tarea ha cambiado. Actualiza la página.');
    return { ...t, raw: resource(raw) };
}
function madrid(civil: string) {
    const local = Date.parse(civil + 'Z');
    const formatter = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Madrid',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    });
    // ZoneInfo uses the first occurrence at a fold and the pre-transition offset
    // at a spring gap. Madrid's two offsets are +02:00 and +01:00.
    const offset = [2, 1].find((hours) => formatter.format(new Date(local - hours * 3600000)).replace(' ', 'T') === civil) ?? 1;
    return civil + '+0' + offset + ':00';
}
async function syncEvent(s: Session, t: Located) {
    const r = await record(t),
        parts = split(t.raw.notes);
    let eid = parts.meta.get('evento');
    if (r.date && r.time) {
        const civil = r.date + 'T' + r.time + ':00';
        const endCivil = new Date(Date.parse(civil + 'Z') + EVENT_MINUTES * 60000).toISOString().slice(0, 19);
        const body = {
            extendedProperties: { private: { taskId: r.id, taskListId: t.listId } },
            summary: r.title,
            description: [parts.notes, t.raw.webViewLink ? 'Tarea: ' + t.raw.webViewLink : ''].filter(Boolean).join('\n\n'),
            start: { dateTime: madrid(civil), timeZone: 'Europe/Madrid' },
            end: { dateTime: madrid(endCivil), timeZone: 'Europe/Madrid' },
            reminders: {
                useDefault: false,
                overrides: [0, ...(r.reminderDays ? [r.reminderDays * 1440] : [])].map((minutes) => ({ method: 'popup', minutes })),
            },
        };
        const linked = eid ? await s.call(CALENDAR + '/' + encodeURIComponent(eid)) : null;
        if (eid && linked && linked.status !== 'cancelled') {
            const updated = await s.call(CALENDAR + '/' + encodeURIComponent(eid), 'PATCH', body);
            if (updated) return t;
        }
        const sourceKey = 'task:' + r.id;
        const deterministicId = await hash('familia:' + sourceKey);
        const creation = {
            ...body,
            extendedProperties: { private: { hermesProfile: 'familia', sourceKey, taskId: r.id, taskListId: t.listId } },
        };
        let event;
        try {
            event = await s.call(CALENDAR, 'POST', { id: deterministicId, ...creation });
        } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 409) throw error;
            const recovered = await s.call(CALENDAR + '/' + deterministicId);
            if (recovered && recovered.status !== 'cancelled') {
                event = await s.call(CALENDAR + '/' + deterministicId, 'PATCH', body);
            } else if (recovered?.status === 'cancelled') {
                event = await s.call(CALENDAR, 'POST', creation);
            } else {
                throw new GoogleTasksUnconfirmed('Calendar creation unconfirmed');
            }
        }
        if (!event || typeof event.id !== 'string') throw new GoogleTasksUnconfirmed('Calendar creation unconfirmed');
        eid = event.id;
        parts.meta.set('evento', eid);
        return patch(s, t, { notes: join(parts.notes, parts.meta) });
    }
    if (eid) {
        await s.call(CALENDAR + '/' + encodeURIComponent(eid), 'DELETE');
        parts.meta.delete('evento');
        return patch(s, t, { notes: join(parts.notes, parts.meta) });
    }
    return t;
}
let writes: Promise<unknown> = Promise.resolve();
function serialized<T>(phase: string, run: (s: Session) => Promise<T>): Promise<T> {
    const next = writes.then(() => {
        const s = new Session();
        return report(phase, s, async () => {
            invalidate();
            try {
                return await run(s);
            } catch (e) {
                if ((s.mutations > 0 || (s.written && !(e instanceof GoogleTasksConflict))) && !(e instanceof GoogleTasksUnconfirmed))
                    throw new GoogleTasksUnconfirmed('Google no ha confirmado la operación.', errorStatus(e));
                throw e;
            } finally {
                invalidate();
            }
        });
    });
    writes = next.catch(() => {});
    return next;
}
export async function saveTask(input: TaskInput) {
    return serialized('save', async (s) => {
        if (input.reminderDays !== undefined && (!Number.isInteger(input.reminderDays) || input.reminderDays < 0 || input.reminderDays > 28))
            throw new Error('Aviso no válido.');
        if (input.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new Error('Hora no válida.');
        if (input.date && (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || new Date(input.date + 'T00:00:00Z').toISOString().slice(0, 10) !== input.date))
            throw new Error('Fecha no válida.');
        const all = await s.all();
        let t = all.find((x) => x.raw.id === input.id);
        const creating = !input.id;
        if (t) {
            const fresh = await s.call(path(t));
            t = fresh && !fresh.deleted ? { ...t, raw: resource(fresh) } : undefined;
        }
        if (!creating && (!t || (await record(t)).revision !== input.revision)) throw new GoogleTasksConflict('La tarea ha cambiado. Actualiza la página.');
        if (creating) {
            if (!input.sourceKey?.trim() || input.sourceKey.length > 300) throw new Error('Origen no válido.');
            const duplicate = all.find((x) => split(x.raw.notes).meta.get('key') === input.sourceKey);
            if (duplicate) {
                const saved = await syncEvent(s, duplicate);
                return { created: false, duplicate: true, record: await verify(s, saved) };
            }
        }
        const old = t ? await record(t) : null;
        if ((input.time ?? old?.time) && !(input.date ?? old?.date)) throw new Error('Una tarea con hora necesita fecha.');
        const owner = input.owner === 'Sin asignar' || input.owner === '' ? 'Familia' : input.owner;
        if (!OWNERS.includes(owner)) throw new Error('Responsable no válido.');
        const lists = await s.lists();
        let listId = lists.get(owner);
        if (!listId) {
            const list = await s.call(TASKS + '/users/@me/lists', 'POST', { title: owner });
            if (!list || typeof list.id !== 'string') throw new GoogleTasksUnconfirmed('List creation unconfirmed');
            listId = list.id;
        }
        if (t && t.owner !== owner) {
            const moved = await s.call(path(t) + '/move?' + new URLSearchParams({ destinationTasklist: listId }), 'POST', undefined, t.raw.etag);
            if (!moved) throw new GoogleTasksConflict('Task changed');
            t = { raw: resource(moved), owner, listId };
        }
        let notes = input.notes;
        if (creating && input.source) notes = [notes, 'Origen: ' + input.source].filter(Boolean).join('\n');
        if (input.owner === 'Sin asignar' || input.owner === '') {
            if (notes === UNASSIGNED) notes = '';
            else if (notes.endsWith('\n' + UNASSIGNED)) notes = notes.slice(0, -UNASSIGNED.length - 1);
            notes = [notes, UNASSIGNED].filter(Boolean).join('\n');
        }
        notes = notes.slice(0, 7000);
        const meta = t ? split(t.raw.notes).meta : new URLSearchParams();
        const set = (k: string, v: unknown) => {
            if (v === undefined) return;
            if (v === null || v === '' || v === 0) meta.delete(k);
            else meta.set(k, String(v));
        };
        if (creating) set('key', input.sourceKey?.trim());
        set('cat', input.category?.slice(0, 40));
        set('hora', input.time);
        set('aviso', input.reminderDays);
        set('estado', input.status === 'waiting' ? 'esperando' : null);
        const body: Json = {
            title: input.title.trim().slice(0, 1024),
            notes: join(notes, meta),
            status: input.status === 'done' ? 'completed' : 'needsAction',
        };
        if (input.date !== undefined) body.due = input.date ? input.date + 'T00:00:00.000Z' : null;
        if (input.status !== 'done') body.completed = null;
        else if (t?.raw.completed) body.completed = t.raw.completed;
        if (t) t = await patch(s, t, body);
        else {
            const raw = await s.call(
                TASKS + '/lists/' + encodeURIComponent(listId) + '/tasks',
                'POST',
                Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null))
            );
            if (!raw) throw new GoogleTasksUnconfirmed('Creation unconfirmed');
            t = { raw: resource(raw), owner, listId };
        }
        t = await syncEvent(s, t);
        const saved = await verify(s, t);
        const expected = {
            title: String(body.title),
            notes: input.owner === 'Sin asignar' || input.owner === '' ? notes.slice(0, -UNASSIGNED.length).replace(/\n$/, '') : notes,
            owner: input.owner || 'Sin asignar',
            date: input.date,
            time: input.time,
            status: input.status,
            category: input.category?.slice(0, 40),
            reminderDays: input.reminderDays,
        };
        for (const [k, v] of Object.entries(expected)) if (v !== undefined && object(saved)[k] !== v) throw new GoogleTasksUnconfirmed('Readback mismatch');
        return creating ? { created: true, duplicate: false, record: saved } : { record: saved, reminderReconciliation: [] };
    });
}
async function verify(s: Session, t: Located) {
    const raw = await s.call(path(t), 'GET', undefined, undefined, 'readback');
    if (!raw || raw.deleted) throw new GoogleTasksUnconfirmed('Readback missing');
    const saved = await record({ ...t, raw: resource(raw) });
    const expected = await record(t);
    if (JSON.stringify(saved) !== JSON.stringify(expected)) throw new GoogleTasksUnconfirmed('Readback mismatch');
    return saved;
}
export async function deleteTask(id: string, revision?: number) {
    return serialized('delete', async (s) => {
        let t = (await s.all()).find((x) => x.raw.id === id);
        if (t) {
            const fresh = await s.call(path(t));
            t = fresh && !fresh.deleted ? { ...t, raw: resource(fresh) } : undefined;
        }
        if (!t || (revision !== undefined && (await record(t)).revision !== revision))
            throw new GoogleTasksConflict('La tarea ha cambiado. Actualiza la página.');
        const eventId = split(t.raw.notes).meta.get('evento');
        if (eventId) await s.call(CALENDAR + '/' + encodeURIComponent(eventId), 'DELETE');
        await s.call(path(t), 'DELETE', undefined, t.raw.etag);
        if (await s.call(path(t), 'GET', undefined, undefined, 'readback')) throw new GoogleTasksUnconfirmed('Deletion not verified');
        return { ok: true };
    });
}
