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


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for field in ('id', 'list-id', 'source-key', 'name', 'address', 'maps-url'):
        p.add_argument('--'+field, required=True)
    for field in ('latitude', 'longitude', 'radius'):
        p.add_argument('--'+field, type=float, required=True)
    p.add_argument('--revision', type=int, required=True)
    p.add_argument('--nearby', choices=('true', 'false'), required=True)
    a = p.parse_args()
    rule = {'version': 1, 'revision': a.revision, 'name': a.name, 'address': a.address,
            'mapsUrl': a.maps_url, 'latitude': a.latitude, 'longitude': a.longitude,
            'radius': a.radius, 'nearby': a.nearby == 'true'}
    try:
        print(json.dumps(author(Runtime({}), a.id, a.list_id, rule, a.source_key)))
    except Exception:
        p.exit(1, 'Notes authoring stopped; no verified change confirmed.\n')
