"""Explicit production verification: only uniquely marked disposable tasks are mutated.
Run baseline before deployment; verify after relay installation. No credentials printed.
"""
import argparse
import hashlib
import json
import os
import sys
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'familia/google-tasks'))
import family_mission
import family_tasks
os.environ['HERMES_HOME'] = '/home/hermes/.hermes/profiles/familia'


def tasks():
    return sorted(family_tasks.broker('list', {'includeDone': True})['tasks'], key=lambda t: t['id'])


def digest(items):
    return hashlib.sha256(json.dumps(items, sort_keys=True).encode()).hexdigest()


def snapshot():
    for _ in range(30):
        body = family_mission.request('records')
        if body.get('taskAvailable'):
            return body
        time.sleep(1)
    raise AssertionError('No fresh production snapshot')


def write(method, record, key):
    try:
        result = family_mission.request('records', method, record, idempotency_key=key)
    except HTTPError as error:
        if error.code != 503:
            raise
        result = json.load(error)
    for _ in range(60):
        if result.get('state') not in ('queued', 'leased', 'executing'):
            break
        time.sleep(1)
        result = family_mission.request('tasks/relay?operation=' + result['operationId'])
    assert result['state'] == 'done', 'Mutation not confirmed: ' + str(result.get('state'))
    return result


def verify(baseline):
    original = json.loads(baseline.read_text())
    assert tasks() == original, 'Original tasks changed before verification'
    mirror = snapshot()
    ids = {t['id'] for t in original}
    assert {r['id'] for r in mirror['records'] if r['kind'] == 'task'} == ids
    local_before = sorted([r for r in mirror['records'] if r['kind'] != 'task'], key=lambda r: r['id'])
    marker = 'Disposable relay verification ' + str(uuid.uuid4())
    draft = dict(kind='task', title=marker, notes='Disposable verification only', owner='Sin asignar',
                 date=str(family_mission.madrid_today()), time='', category='family', reminderDays=0,
                 status='open', recurrence='none', checklist=[], source='Familia')
    created_ids = set()
    evidence = []

    def check(saved, **expected):
        live = next(t for t in tasks() if t['id'] == saved['id'])
        record = family_tasks.to_record(live)
        for key, value in expected.items():
            assert record[key] == value, 'Broker readback mismatch: ' + key
        visible = next(r for r in snapshot()['records'] if r['id'] == saved['id'])
        assert visible['revision'] == saved['revision']
        for key, value in expected.items():
            assert visible[key] == value, 'Dashboard snapshot mismatch: ' + key

    try:
        key = 'verify-' + str(uuid.uuid4())
        first = write('POST', draft, key)
        saved = first['record']
        created_ids.add(saved['id'])
        assert saved['id'] not in ids
        check(saved, title=marker, notes='Disposable verification only\nOrigen: Familia', owner='Sin asignar', status='open')
        replay = write('POST', draft, key)
        assert replay['operationId'] == first['operationId'] and replay['record']['id'] == saved['id']
        evidence.append('create + same-key retry: one Google identity; source notes and unassigned owner verified')
        saved = write('POST', {**saved, 'title': marker + ' updated', 'notes': 'Updated verification only'}, 'verify-' + str(uuid.uuid4()))['record']
        check(saved, title=marker + ' updated', notes='Updated verification only', owner='Sin asignar', status='open')
        evidence.append('update: Dashboard and broker readback match')
        saved = write('POST', {**saved, 'status': 'done'}, 'verify-' + str(uuid.uuid4()))['record']
        check(saved, status='done')
        assert saved.get('completedAt')
        completion_digest=family_mission.request('completion-digest?date='+str(family_mission.madrid_today()))
        assert any(r['id']==saved['id'] for r in completion_digest['inferred'])
        evidence.append('complete: done, Google timestamp and production completion digest verified')
        write('DELETE', {'id': saved['id'], 'revision': saved['revision']}, 'verify-' + str(uuid.uuid4()))
        assert all(t['id'] != saved['id'] for t in tasks())
        assert all(r['id'] != saved['id'] for r in snapshot()['records'])
        evidence.append('delete: absent in broker and Dashboard')
        again = write('POST', draft, 'verify-' + str(uuid.uuid4()))['record']
        created_ids.add(again['id'])
        assert again['id'] != saved['id'] and again['id'] not in ids
        check(again, title=marker, status='open')
        write('DELETE', {'id': again['id'], 'revision': again['revision']}, 'verify-' + str(uuid.uuid4()))
        evidence.append('identical deliberate recreate after deletion: new identity; cleaned up through Dashboard')
    finally:
        # Recovery may only target this run's exact title marker and known/new identity.
        leftovers = [t for t in tasks() if t['id'] not in ids and t['title'].startswith(marker)]
        for item in leftovers:
            current = next(r for r in snapshot()['records'] if r['id'] == item['id'])
            write('DELETE', {'id': current['id'], 'revision': current['revision']}, 'cleanup-' + str(uuid.uuid4()))
        final = tasks()
        assert final == original, 'Original family tasks did not remain unchanged'
        assert sorted([r for r in snapshot()['records'] if r['kind'] != 'task'], key=lambda r: r['id']) == local_before
    print(json.dumps({'passed': evidence, 'originalTaskCount': len(original), 'originalTasksSHA256': digest(original),
                      'originalTasksUnchanged': True, 'nonTaskRecordsUnchanged': True, 'cleanupComplete': True,
                      'verifiedAtUTC': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['baseline', 'verify'])
    parser.add_argument('baseline', type=Path)
    args = parser.parse_args()
    if args.action == 'baseline':
        items = tasks()
        fd = os.open(args.baseline, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as output:
            json.dump(items, output)
        print(json.dumps({'originalTaskCount': len(items), 'originalTasksSHA256': digest(items)}))
    else:
        verify(args.baseline)
