import 'server-only';

import ICAL from 'ical.js';

export type SerializableCalendarItem = {
    uid: string;
    title: string;
    description?: string | null;
    location?: string | null;
    startDate: string;
    endDate: string;
    isAllDay: boolean;
    sequence?: number | null;
};

export type SerializeCalendarItemInput = {
    item: SerializableCalendarItem;
    existingIcs?: string | null;
    nowIso?: string;
};

const PRODID = '-//Family Organizer//Calendar Sync//EN';

const EDITABLE_PROPS = new Set(['summary', 'description', 'location', 'dtstart', 'dtend', 'dtstamp', 'last-modified', 'sequence']);

function asIcalDate(value: string, isAllDay: boolean) {
    if (isAllDay) {
        const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) {
            throw new Error(`Cannot serialize all-day date from value "${value}"`);
        }
        return ICAL.Time.fromData({
            year: Number(match[1]),
            month: Number(match[2]),
            day: Number(match[3]),
            isDate: true,
        });
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`Cannot serialize timed date from value "${value}"`);
    }
    return ICAL.Time.fromJSDate(date, true);
}

function endDateForAllDay(value: string) {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) {
        throw new Error(`Cannot serialize all-day end date from value "${value}"`);
    }
    return ICAL.Time.fromData({
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
        isDate: true,
    });
}

function buildEmptyVCalendar() {
    const calendar = new ICAL.Component(['vcalendar', [], []]);
    calendar.updatePropertyWithValue('prodid', PRODID);
    calendar.updatePropertyWithValue('version', '2.0');
    return calendar;
}

function pickPrimaryVEvent(calendar: ICAL.Component) {
    const vevents = calendar.getAllSubcomponents('vevent') || [];
    const master = vevents.find((event: any) => !event.getFirstPropertyValue('recurrence-id'));
    return master || vevents[0] || null;
}

function applyEditableFieldsToVEvent(vevent: ICAL.Component, item: SerializableCalendarItem, nowIso: string) {
    vevent.updatePropertyWithValue('uid', item.uid);
    vevent.updatePropertyWithValue('summary', item.title || '');

    if (item.description != null && item.description !== '') {
        vevent.updatePropertyWithValue('description', item.description);
    } else {
        vevent.removeAllProperties('description');
    }

    if (item.location != null && item.location !== '') {
        vevent.updatePropertyWithValue('location', item.location);
    } else {
        vevent.removeAllProperties('location');
    }

    vevent.removeAllProperties('dtstart');
    vevent.removeAllProperties('dtend');
    vevent.addPropertyWithValue('dtstart', asIcalDate(item.startDate, item.isAllDay));
    vevent.addPropertyWithValue(
        'dtend',
        item.isAllDay ? endDateForAllDay(item.endDate) : asIcalDate(item.endDate, false)
    );

    vevent.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(nowIso), true));
    vevent.updatePropertyWithValue('last-modified', ICAL.Time.fromJSDate(new Date(nowIso), true));

    const previousSequence = Number(vevent.getFirstPropertyValue('sequence') || item.sequence || 0);
    vevent.updatePropertyWithValue('sequence', previousSequence + 1);
}

export function serializeCalendarItemToIcs(input: SerializeCalendarItemInput): string {
    const nowIso = input.nowIso || new Date().toISOString();

    if (input.existingIcs && input.existingIcs.trim()) {
        const calendar = new ICAL.Component(ICAL.parse(input.existingIcs));
        const vevent = pickPrimaryVEvent(calendar);
        if (!vevent) {
            throw new Error('Existing ICS does not contain a VEVENT to update');
        }
        applyEditableFieldsToVEvent(vevent, input.item, nowIso);
        return calendar.toString();
    }

    const calendar = buildEmptyVCalendar();
    const vevent = new ICAL.Component('vevent');
    applyEditableFieldsToVEvent(vevent, input.item, nowIso);
    vevent.updatePropertyWithValue(
        'created',
        ICAL.Time.fromJSDate(new Date(nowIso), true)
    );
    calendar.addSubcomponent(vevent);
    return calendar.toString();
}

export function listEditableIcsPropertyNames() {
    return Array.from(EDITABLE_PROPS);
}
