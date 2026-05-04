import { describe, expect, it } from 'vitest';
import { serializeCalendarItemToIcs } from '@/lib/apple-caldav/serialize';

const NOW_ISO = '2026-05-04T12:00:00.000Z';

const ORIGINAL_RICH_ICS = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Apple Inc.//iOS 18.0//EN',
    'BEGIN:VEVENT',
    'UID:event-1@icloud',
    'DTSTAMP:20260101T120000Z',
    'CREATED:20260101T120000Z',
    'DTSTART:20260310T130000Z',
    'DTEND:20260310T140000Z',
    'SUMMARY:Original title',
    'DESCRIPTION:Original notes',
    'LOCATION:Original place',
    'SEQUENCE:2',
    'CATEGORIES:family,personal',
    'CLASS:PRIVATE',
    'X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT15M',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    'TRIGGER:-PT15M',
    'END:VALARM',
    'ATTENDEE;CN=Parent;PARTSTAT=ACCEPTED:mailto:parent@example.com',
    'END:VEVENT',
    'END:VCALENDAR',
].join('\r\n');

describe('serializeCalendarItemToIcs', () => {
    it('updates only editable fields and preserves alarms, attendees, categories, and X-APPLE props', () => {
        const ics = serializeCalendarItemToIcs({
            existingIcs: ORIGINAL_RICH_ICS,
            nowIso: NOW_ISO,
            item: {
                uid: 'event-1@icloud',
                title: 'Edited title',
                description: 'Edited notes',
                location: 'Edited place',
                startDate: '2026-03-10T15:00:00.000Z',
                endDate: '2026-03-10T16:00:00.000Z',
                isAllDay: false,
            },
        });

        expect(ics).toContain('SUMMARY:Edited title');
        expect(ics).toContain('DESCRIPTION:Edited notes');
        expect(ics).toContain('LOCATION:Edited place');
        expect(ics).toContain('DTSTART:20260310T150000Z');
        expect(ics).toContain('DTEND:20260310T160000Z');

        // Preserved unknown / unmodeled properties:
        expect(ics).toContain('BEGIN:VALARM');
        expect(ics).toContain('TRIGGER:-PT15M');
        expect(ics).toContain('END:VALARM');
        expect(ics).toMatch(/ATTENDEE;.*CN=Parent.*:mailto:parent@example\.com/);
        expect(ics).toContain('CATEGORIES:family,personal');
        expect(ics).toContain('CLASS:PRIVATE');
        expect(ics).toContain('X-APPLE-TRAVEL-DURATION');
    });

    it('bumps SEQUENCE so peer clients accept the update (RFC 5545)', () => {
        const ics = serializeCalendarItemToIcs({
            existingIcs: ORIGINAL_RICH_ICS,
            nowIso: NOW_ISO,
            item: {
                uid: 'event-1@icloud',
                title: 'Edited',
                startDate: '2026-03-10T13:00:00.000Z',
                endDate: '2026-03-10T14:00:00.000Z',
                isAllDay: false,
            },
        });

        // Original was SEQUENCE:2 -> should become 3.
        expect(ics).toContain('SEQUENCE:3');
        expect(ics).not.toContain('SEQUENCE:2');
    });

    it('refreshes DTSTAMP and LAST-MODIFIED to nowIso', () => {
        const ics = serializeCalendarItemToIcs({
            existingIcs: ORIGINAL_RICH_ICS,
            nowIso: NOW_ISO,
            item: {
                uid: 'event-1@icloud',
                title: 'Edited',
                startDate: '2026-03-10T13:00:00.000Z',
                endDate: '2026-03-10T14:00:00.000Z',
                isAllDay: false,
            },
        });

        expect(ics).toContain('DTSTAMP:20260504T120000Z');
        expect(ics).toContain('LAST-MODIFIED:20260504T120000Z');
    });

    it('emits VALUE=DATE properties for all-day events', () => {
        const ics = serializeCalendarItemToIcs({
            existingIcs: null,
            nowIso: NOW_ISO,
            item: {
                uid: 'allday-1',
                title: 'Birthday',
                startDate: '2026-04-01',
                endDate: '2026-04-02',
                isAllDay: true,
            },
        });

        expect(ics).toMatch(/DTSTART;VALUE=DATE:20260401/);
        expect(ics).toMatch(/DTEND;VALUE=DATE:20260402/);
    });

    it('builds a fresh VCALENDAR when no existingIcs is provided', () => {
        const ics = serializeCalendarItemToIcs({
            existingIcs: null,
            nowIso: NOW_ISO,
            item: {
                uid: 'fresh-1',
                title: 'New event',
                startDate: '2026-06-15T09:00:00.000Z',
                endDate: '2026-06-15T10:00:00.000Z',
                isAllDay: false,
            },
        });

        expect(ics).toContain('BEGIN:VCALENDAR');
        expect(ics).toContain('PRODID:-//Family Organizer//Calendar Sync//EN');
        expect(ics).toContain('VERSION:2.0');
        expect(ics).toContain('UID:fresh-1');
        expect(ics).toContain('SUMMARY:New event');
        expect(ics).toContain('DTSTART:20260615T090000Z');
        expect(ics).toContain('SEQUENCE:1');
        expect(ics).toContain('CREATED:20260504T120000Z');
        expect(ics).toContain('END:VCALENDAR');
    });

    it('removes DESCRIPTION/LOCATION when they are cleared in the edit', () => {
        const ics = serializeCalendarItemToIcs({
            existingIcs: ORIGINAL_RICH_ICS,
            nowIso: NOW_ISO,
            item: {
                uid: 'event-1@icloud',
                title: 'Edited',
                description: '',
                location: null,
                startDate: '2026-03-10T13:00:00.000Z',
                endDate: '2026-03-10T14:00:00.000Z',
                isAllDay: false,
            },
        });

        // Only check the VEVENT block (above any VALARM); alarm descriptions are not
        // owned by the editable surface.
        const veventStart = ics.indexOf('BEGIN:VEVENT');
        const valarmStart = ics.indexOf('BEGIN:VALARM');
        const veventBody = ics.slice(veventStart, valarmStart > -1 ? valarmStart : ics.indexOf('END:VEVENT'));
        expect(veventBody).not.toMatch(/^DESCRIPTION[:;]/m);
        expect(veventBody).not.toMatch(/^LOCATION[:;]/m);
    });
});
