import 'server-only';

import { APPLE_CALDAV_PROVIDER } from '@/lib/apple-caldav/config';
import { decryptCalendarCredential } from '@/lib/apple-caldav/crypto';
import { listCalendarSyncAccounts, listCalendarSyncCalendars } from '@/lib/apple-caldav/repository';
import {
    SerializableCalendarItem,
    serializeCalendarItemToIcs,
} from '@/lib/apple-caldav/serialize';
import {
    CalDAVETagMismatchError,
    CalDAVNotFoundError,
    CalDAVUidConflictError,
    createAppleCalendarObject,
    deleteAppleCalendarObject,
    fetchAppleCalendarObject,
    updateAppleCalendarObject,
} from '@/lib/apple-caldav/write-client';
import { getInstantAdminDb } from '@/lib/instant-admin';

export type PushResult =
    | { status: 'synced'; remoteUrl: string; etag: string }
    | { status: 'conflict'; reason: 'remote_changed' | 'uid_conflict' }
    | { status: 'noop'; reason: NoopReason };

export type DeleteResult =
    | { status: 'deleted' }
    | { status: 'conflict'; reason: 'remote_changed' }
    | { status: 'noop'; reason: NoopReason };

type NoopReason =
    | 'not_apple_sourced'
    | 'remote_readonly'
    | 'account_inactive'
    | 'no_target_calendar'
    | 'missing_remote_url'
    | 'missing_etag';

const APPLE_SOURCE_TYPE = 'apple-caldav';

async function loadCalendarItem(itemId: string) {
    const db = getInstantAdminDb();
    const result = await db.query({ calendarItems: { $: { where: { id: itemId } } } });
    return ((result.calendarItems as any[]) || [])[0] || null;
}

async function loadActiveAppleAccount() {
    const accounts = (await listCalendarSyncAccounts()) as any[];
    return accounts.find((account) => account.provider === APPLE_CALDAV_PROVIDER && account.status === 'active') || null;
}

async function loadCalendarRow(accountId: string, remoteCalendarId: string) {
    const calendars = (await listCalendarSyncCalendars(accountId)) as any[];
    return calendars.find((calendar) => calendar.remoteCalendarId === remoteCalendarId) || null;
}

async function persistItemPatch(itemId: string, patch: Record<string, any>) {
    const db = getInstantAdminDb();
    await db.transact([db.tx.calendarItems[itemId].update(patch)]);
}

function toSerializableItem(item: any): SerializableCalendarItem {
    return {
        uid: String(item.uid || ''),
        title: String(item.title || 'Untitled event'),
        description: typeof item.description === 'string' ? item.description : '',
        location: typeof item.location === 'string' ? item.location : '',
        startDate: String(item.startDate || ''),
        endDate: String(item.endDate || item.startDate || ''),
        isAllDay: Boolean(item.isAllDay),
        sequence: Number(item.sequence || 0),
    };
}

export async function pushCalendarItemToApple(input: {
    itemId: string;
    targetCalendarId?: string;
    nowIso?: string;
}): Promise<PushResult> {
    const nowIso = input.nowIso || new Date().toISOString();
    const item = await loadCalendarItem(input.itemId);
    if (!item) {
        throw new Error(`Calendar item not found: ${input.itemId}`);
    }

    const isAppleSourced = item.sourceType === APPLE_SOURCE_TYPE;
    if (!isAppleSourced && !input.targetCalendarId) {
        return { status: 'noop', reason: 'not_apple_sourced' };
    }

    const account = await loadActiveAppleAccount();
    if (!account) {
        return { status: 'noop', reason: 'account_inactive' };
    }

    const targetCalendarId = input.targetCalendarId || item.sourceCalendarId;
    if (!targetCalendarId) {
        return { status: 'noop', reason: 'no_target_calendar' };
    }

    const calendarRow = await loadCalendarRow(account.id, targetCalendarId);
    if (!calendarRow || !calendarRow.remoteUrl) {
        return { status: 'noop', reason: 'no_target_calendar' };
    }

    if (calendarRow.canWrite === false) {
        await persistItemPatch(input.itemId, {
            sourceSyncStatus: 'remote-readonly',
            sourceLastErrorMessage: '',
            updatedAt: nowIso,
        });
        return { status: 'noop', reason: 'remote_readonly' };
    }

    const password = decryptCalendarCredential(account.passwordCiphertext);

    try {
        if (item.sourceRemoteUrl && item.sourceRemoteEtag) {
            const current = await fetchAppleCalendarObject({
                username: account.username,
                password,
                url: item.sourceRemoteUrl,
            });
            const ics = serializeCalendarItemToIcs({
                existingIcs: current.ics,
                item: toSerializableItem(item),
                nowIso,
            });
            const result = await updateAppleCalendarObject({
                username: account.username,
                password,
                url: item.sourceRemoteUrl,
                ics,
                etag: item.sourceRemoteEtag,
            });
            const newEtag = result.etag || current.etag;
            await persistItemPatch(input.itemId, {
                sourceRemoteEtag: newEtag,
                sourceSyncStatus: 'synced',
                sourceLastPushedAt: nowIso,
                sourceLastErrorMessage: '',
                sequence: (Number(item.sequence) || 0) + 1,
                updatedAt: nowIso,
            });
            return { status: 'synced', remoteUrl: item.sourceRemoteUrl, etag: newEtag };
        }

        const uid = item.uid && String(item.uid).trim() ? String(item.uid).trim() : `family-organizer-${input.itemId}`;
        const ics = serializeCalendarItemToIcs({
            existingIcs: null,
            item: { ...toSerializableItem(item), uid },
            nowIso,
        });
        const created = await createAppleCalendarObject({
            username: account.username,
            password,
            calendarUrl: calendarRow.remoteUrl,
            ics,
            uid,
        });
        await persistItemPatch(input.itemId, {
            uid,
            sourceType: APPLE_SOURCE_TYPE,
            sourceAccountKey: account.id,
            sourceCalendarId: calendarRow.remoteCalendarId,
            sourceCalendarName: calendarRow.displayName,
            sourceRemoteUrl: created.url,
            sourceRemoteEtag: created.etag,
            sourceSyncStatus: 'synced',
            sourceLastPushedAt: nowIso,
            sourceLastErrorMessage: '',
            sourceReadOnly: false,
            sequence: 1,
            updatedAt: nowIso,
        });
        return { status: 'synced', remoteUrl: created.url, etag: created.etag };
    } catch (error) {
        if (error instanceof CalDAVETagMismatchError || error instanceof CalDAVNotFoundError) {
            await persistItemPatch(input.itemId, {
                sourceSyncStatus: 'remote-changed',
                sourceLastErrorMessage: error.message,
                updatedAt: nowIso,
            });
            return { status: 'conflict', reason: 'remote_changed' };
        }
        if (error instanceof CalDAVUidConflictError) {
            await persistItemPatch(input.itemId, {
                sourceSyncStatus: 'uid-conflict',
                sourceLastErrorMessage: error.message,
                updatedAt: nowIso,
            });
            return { status: 'conflict', reason: 'uid_conflict' };
        }
        const message = error instanceof Error ? error.message : 'Push failed';
        await persistItemPatch(input.itemId, {
            sourceSyncStatus: 'failed',
            sourceLastErrorMessage: message,
            updatedAt: nowIso,
        });
        throw error;
    }
}

export async function pushCalendarItemDeletionToApple(input: {
    itemId: string;
    nowIso?: string;
}): Promise<DeleteResult> {
    const nowIso = input.nowIso || new Date().toISOString();
    const item = await loadCalendarItem(input.itemId);
    if (!item) {
        throw new Error(`Calendar item not found: ${input.itemId}`);
    }
    if (item.sourceType !== APPLE_SOURCE_TYPE) {
        return { status: 'noop', reason: 'not_apple_sourced' };
    }
    if (!item.sourceRemoteUrl) {
        return { status: 'noop', reason: 'missing_remote_url' };
    }
    if (!item.sourceRemoteEtag) {
        return { status: 'noop', reason: 'missing_etag' };
    }

    const account = await loadActiveAppleAccount();
    if (!account) {
        return { status: 'noop', reason: 'account_inactive' };
    }

    const password = decryptCalendarCredential(account.passwordCiphertext);

    try {
        await deleteAppleCalendarObject({
            username: account.username,
            password,
            url: item.sourceRemoteUrl,
            etag: item.sourceRemoteEtag,
        });
        await persistItemPatch(input.itemId, {
            sourceSyncStatus: 'deleted-by-app',
            sourceLastPushedAt: nowIso,
            sourceLastErrorMessage: '',
            status: 'cancelled',
            updatedAt: nowIso,
        });
        return { status: 'deleted' };
    } catch (error) {
        if (error instanceof CalDAVETagMismatchError) {
            await persistItemPatch(input.itemId, {
                sourceSyncStatus: 'remote-changed',
                sourceLastErrorMessage: error.message,
                updatedAt: nowIso,
            });
            return { status: 'conflict', reason: 'remote_changed' };
        }
        const message = error instanceof Error ? error.message : 'Delete failed';
        await persistItemPatch(input.itemId, {
            sourceSyncStatus: 'failed',
            sourceLastErrorMessage: message,
            updatedAt: nowIso,
        });
        throw error;
    }
}
