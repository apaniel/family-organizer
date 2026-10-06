#!/usr/bin/env python3
"""Explicit authoring only: canonical get -> protected notes update -> get verify."""
import argparse
import json
from google_notes import update_notes, validate, parse
from notes_runner import Runtime, identity, active


def author(runtime, task_id, list_id, rule, source_key):
    old = runtime.tasks('get', {'id': task_id})['task']
    identity(old)
    if old['listId'] != list_id or old['id'] != task_id or not active(old) or old.get('sourceKey') != source_key:
        raise ValueError('Exact active task/source identity required')
    rule = validate(rule)
    if rule['version'] == 2 and rule['trigger']['type'] == 'presence_at':
        from google_notes import due_stamp
        import time
        if due_stamp(rule['trigger']['dueAt']) <= time.time():
            raise ValueError('Expired dueAt cannot arm a new obligation')
    notes = update_notes(old['notes'], rule)
    if parse(notes) != rule:
        raise ValueError('Generated rule mismatch')
    # Metadata is owned by broker: patch notes only, never recreate/move/complete.
    runtime.tasks('update', {'id': task_id, 'task': {'notes': notes}})
    current = runtime.tasks('get', {'id': task_id})['task']
    if (identity(current) != identity(old) or not active(current)
            or current.get('sourceKey') != source_key or current.get('notes') != notes or parse(current.get('notes')) != rule):
        raise ValueError('Notes update not verified')
    return {'verified': True, 'id': task_id, 'listId': list_id}




def migrate_legacy(state, task, rule, legacy, evaluated_at):
    """Explicit offline ledger migration AFTER parent-authorized canonical notes migration.

    Never contacts Tasks, invents a new receipt key, or resets an existing claim.
    """
    from google_notes import fingerprint, trigger, due_stamp
    from notes_runner import identity
    from presence_state import validate as validate_legacy
    validate_legacy(legacy)
    claim = legacy['claim']
    if not claim or claim['status'] == 'retry':
        raise ValueError('Unconsumed legacy operation requires fresh parent decision')
    if trigger(rule)['type'] != 'presence_at' or parse(task['notes']) != rule:
        raise ValueError('Explicit canonical presence migration required')
    key = identity(task)
    if key in state.data['items']:
        raise ValueError('Existing obligation must not be replaced')
    due = due_stamp(trigger(rule)['dueAt'])
    if evaluated_at < due:
        raise ValueError('Actual evaluation must follow dueAt')
    status = claim['status']
    state.data['items'][key] = {'listId': task['listId'], 'id': task['id'], 'fingerprint': fingerprint(rule),
        'phase': None, 'lastfix': 0, 'delivery': status if status in ('sent', 'unknown') else 'stopped',
        'attempts': 1, 'episode': 1, 'evaluated_at': evaluated_at, 'due_at': due,
        'outcome': 'legacy_consumed', 'legacy_body': claim['body']}
    state.save()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    import sys
    if '--migrate-legacy' in sys.argv:
        from pathlib import Path
        from notes_state import State
        m = argparse.ArgumentParser(description='Offline migration only; explicit parent-authorized canonical notes required')
        m.add_argument('--migrate-legacy', action='store_true')
        m.add_argument('--canonical-task', type=Path, required=True)
        m.add_argument('--legacy-state', type=Path, required=True)
        m.add_argument('--state', type=Path, required=True)
        m.add_argument('--evaluated-at', required=True)
        args = m.parse_args()
        try:
            from google_notes import due_stamp
            task = json.loads(args.canonical_task.read_text())
            with State(args.state) as state:
                migrate_legacy(state, task, parse(task['notes']), json.loads(args.legacy_state.read_text()), due_stamp(args.evaluated_at))
        except Exception:
            m.exit(1, 'Migration stopped; no reset or real task write.\n')
        m.exit(0)
    for field in ('id', 'list-id', 'source-key', 'name', 'address', 'maps-url'):
        p.add_argument('--'+field, required=True)
    for field in ('latitude', 'longitude', 'radius'):
        p.add_argument('--'+field, type=float, required=True)
    p.add_argument('--revision', type=int, required=True)
    p.add_argument('--nearby', choices=('true', 'false'))
    p.add_argument('--trigger', choices=('arrival', 'presence_at'))
    p.add_argument('--due-at')
    a = p.parse_args()
    if a.trigger != 'presence_at' and a.nearby is None:
        p.error('--nearby must be explicit for arrival')
    if a.trigger != 'presence_at' and a.due_at is not None:
        p.error('--due-at requires presence_at')
    rule = {'version': 1, 'revision': a.revision, 'name': a.name, 'address': a.address,
            'mapsUrl': a.maps_url, 'latitude': a.latitude, 'longitude': a.longitude,
            'radius': a.radius, 'nearby': a.nearby == 'true'}
    if a.trigger:
        rule['version'] = 2
        del rule['nearby']
        rule['trigger'] = ({'type': 'presence_at', 'dueAt': a.due_at} if a.trigger == 'presence_at'
                           else {'type': 'arrival', 'nearby': a.nearby == 'true'})
    try:
        print(json.dumps(author(Runtime({}), a.id, a.list_id, rule, a.source_key)))
    except Exception:
        p.exit(1, 'Notes authoring stopped; no verified change confirmed.\n')
