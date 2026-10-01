"""Family tasks on Google Tasks (losapalas), through the local tasks broker, in the planner's record shape."""
import json, os, subprocess
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

CLIENT = '/opt/hermes-tasks/client.py'
MADRID = ZoneInfo('Europe/Madrid')
UNASSIGNED_NOTE = 'Responsable (Dashboard): Sin asignar'

def split_unassigned_note(notes):
    notes = notes or ''
    if notes == UNASSIGNED_NOTE: return '', True
    suffix = '\n' + UNASSIGNED_NOTE
    return (notes[:-len(suffix)], True) if notes.endswith(suffix) else (notes, False)


def broker(action, payload=None):
    if os.environ.get('HERMES_HOME', '/home/hermes/.hermes/profiles/familia').rstrip('/') != '/home/hermes/.hermes/profiles/familia':
        raise ValueError('Use the familia profile.')
    r = subprocess.run(['python3', CLIENT, action], input=json.dumps(payload or {}), capture_output=True, text=True, timeout=180)
    try:
        body = json.loads(r.stdout or '{}')
    except ValueError:
        body = {}
    if r.returncode:
        raise ValueError(body.get('error') or 'Google Tasks unavailable. No change confirmed.')
    return body


def to_record(t):
    notes, unassigned = split_unassigned_note(t['notes'])
    owner = 'Sin asignar' if t['owner'] == 'Familia' and unassigned else t['owner']
    status = 'done' if t['done'] else 'waiting' if t['waiting'] else 'open'
    return {'kind': 'task', 'id': t['id'], 'title': t['title'], 'date': t['due'] or '', 'endDate': '', 'time': t['time'] or '',
            'endTime': '', 'owner': owner or 'Sin asignar', 'status': status, 'category': t['category'] or '', 'notes': notes if unassigned and owner == 'Sin asignar' else t['notes'],
            'checklist': [], 'audience': 'adults', 'recurrence': 'none', 'confirmed': True, 'reminderDays': t['reminderDays'],
            'sourceKey': t['sourceKey'], 'updatedAt': t['updated'], 'completedAt': t['completed'], 'eventId': t['eventId'],
            'webViewLink': t['webViewLink'], 'store': 'google-tasks'}


def to_fields(record, *, creating):
    if record.get('checklist'):
        raise ValueError('Tasks are binary; each action must be a separate task.')
    if record.get('recurrence') not in (None, '', 'none'):
        raise ValueError('Google Tasks has no recurring tasks. Create a separate task for each occurrence.')
    fields = {}
    for src, dst in (('title', 'title'), ('owner', 'owner'), ('category', 'category'), ('reminderDays', 'reminderDays')):
        if src in record:
            fields[dst] = record[src]
    unassigned = fields.get('owner') in ('Sin asignar', '')
    if unassigned:
        fields['owner'] = 'Familia'
    if 'date' in record:
        fields['due'] = record['date'] or None
    if 'time' in record:
        fields['time'] = record['time'] or None
    notes = record.get('notes')
    if creating and record.get('source'):
        notes = '\n'.join(x for x in (notes or '', 'Origen: ' + record['source']) if x)
    if unassigned:
        notes = '\n'.join(x for x in (split_unassigned_note(notes)[0], UNASSIGNED_NOTE) if x)
    if notes is not None:
        fields['notes'] = notes
    if 'status' in record:
        if record['status'] not in ('open', 'waiting', 'done'):
            raise ValueError('Task status must be open, waiting or done.')
        fields['done'] = record['status'] == 'done'
        fields['waiting'] = record['status'] == 'waiting'
    if creating:
        if not record.get('sourceKey'):
            raise ValueError('New Hermes records require a stable sourceKey.')
        fields['sourceKey'] = record['sourceKey']
    return fields


def list_tasks(include_done=True):
    return [to_record(t) for t in broker('list', {'includeDone': include_done})['tasks']]


def save(record):
    if record.get('id'):
        return {'record': to_record(broker('update', {'id': record['id'], 'task': to_fields(record, creating=False)})['task'])}
    res = broker('create', {'task': to_fields(record, creating=True)})
    return {'record': to_record(res['task']), 'created': res['created'], 'duplicate': res.get('duplicate', False)}


def complete(task_id):
    return {'record': to_record(broker('complete', {'id': task_id})['task'])}


def delete(task_id):
    return broker('delete', {'id': task_id})


def due_reminders(today):
    """Open tasks that are overdue, due today, or inside their reminder window."""
    out = []
    for r in list_tasks(include_done=False):
        if r['date'] and date.fromisoformat(r['date']) - timedelta(days=r['reminderDays'] or 0) <= today:
            out.append(r)
    return out


def completion_digest(day):
    # The broker exposes completion time, but no channel or evidence provenance.
    entries = []
    for r in list_tasks():
        stamp = r['completedAt']
        if r['status'] == 'done' and stamp:
            local = datetime.fromisoformat(stamp.replace('Z', '+00:00')).astimezone(MADRID)
            if local.date().isoformat() == day:
                entries.append({'id': r['id'], 'title': r['title'], 'owner': r['owner'], 'completedAt': stamp, 'channel': 'other'})
    return {'date': day, 'explicit': [], 'inferred': sorted(entries, key=lambda e: e['completedAt']), 'store': 'google-tasks'}
