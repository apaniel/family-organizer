#!/usr/bin/env python3
"""Outbound-only Google Tasks transport. No broker credentials or public listener."""
import hashlib
import json
import logging
import os
import sys
import time
from pathlib import Path

HOME = '/home/hermes/.hermes/profiles/familia'
os.environ['HERMES_HOME'] = HOME
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'familia/google-tasks'))
import family_mission
import family_tasks


def snapshot():
    records = family_tasks.list_tasks()
    for record in records:
        # Google updated timestamp detects preflight conflicts; the broker has no CAS.
        record['revision'] = int(hashlib.sha256(record['updatedAt'].encode()).hexdigest()[:13], 16)
        record.setdefault('slot', 'dinner')
        record.setdefault('source', 'Google Tasks')
    return records


def relay(body):
    return family_mission.request('tasks/relay', 'POST', body)


class TaskConflict(ValueError):
    pass

def execute(payload, before):
    record = payload['record']
    old = next((r for r in before if r['id'] == record.get('id')), None)
    if record.get('id') and (not old or old['revision'] != record['revision']):
        raise TaskConflict('Task changed before execution')
    if payload['action'] == 'delete':
        family_tasks.delete(record['id'])
        after = snapshot()
        if any(r['id'] == record['id'] for r in after):
            raise RuntimeError('Deletion not verified')
        return {'ok': True}, after
    if not record.get('id'):
        record = dict(record)
        if not record.get('sourceKey'):
            record['sourceKey'] = payload['sourceKey']
    fields = family_tasks.to_fields(record, creating=not record.get('id'))
    expected = dict(record)
    if 'notes' in fields:
        notes, unassigned = family_tasks.split_unassigned_note(fields['notes'])
        expected['notes'] = notes if unassigned and fields.get('owner') == 'Familia' else fields['notes']
    if 'owner' in fields: expected['owner'] = 'Sin asignar' if record.get('owner') in ('', 'Sin asignar') else fields['owner']
    result = family_tasks.save(record)
    after = snapshot()
    saved = next((r for r in after if r['id'] == result['record']['id']), None)
    if not saved:
        raise RuntimeError('Save not verified')
    # A broker sourceKey duplicate must never overwrite a previously completed task.
    if not result.get('duplicate'):
        for key in ('title', 'notes', 'owner', 'date', 'time', 'status', 'category', 'reminderDays'):
            if key in expected and saved.get(key) != expected[key]:
                raise RuntimeError('Readback mismatch')
    return {**result, 'record': saved}, after


def tick():
    command = relay({'action': 'claim'})['command']
    if not command:
        generation = relay({'action': 'snapshot-start'})['generation']
        if generation is not None:
            relay({'action': 'snapshot', 'generation': generation, 'records': snapshot()})
        return
    identity = {'id': command['id'], 'leaseToken': command['leaseToken']}
    # Read before beginning. A failure here is safe to retry after the claim lease expires.
    before = snapshot()
    relay({'action': 'begin', **identity})
    payload = command['payload']
    payload['sourceKey'] = 'dashboard-relay:' + hashlib.sha256(command['id'].encode()).hexdigest()
    try:
        result, after = execute(payload, before)
        completion = {'action': 'finish', **identity, 'state': 'done', 'result': result, 'records': after}
    except TaskConflict:
        completion = {'action': 'finish', **identity, 'state': 'failed', 'records': before}
    except ValueError:
        # Adapter/broker errors can arrive after a write; never blindly replay them.
        completion = {'action': 'finish', **identity, 'state': 'ambiguous'}
        try:
            completion['records'] = snapshot()
        except Exception:
            pass
    except Exception:
        completion = {'action': 'finish', **identity, 'state': 'ambiguous'}
    # If this acknowledgement is lost the server fences the operation as ambiguous.
    # It never reissues an already-started Google mutation.
    relay(completion)


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
    delay = 2
    while True:
        try:
            tick()
            delay = 2
        except Exception:
            logging.warning('Relay unavailable; no operation replayed')
            delay = min(30, delay * 2)
        time.sleep(delay)

if __name__ == '__main__':
    main()
