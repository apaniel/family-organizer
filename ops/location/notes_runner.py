#!/usr/bin/env python3
"""Google notes -> read-only latest fix -> approved private receipt adapter."""
import argparse
from datetime import datetime
import hashlib
import json
import math
from pathlib import Path
import signal
import subprocess
import sys
import time

from google_notes import parse, fingerprint
from notes_state import State

TASKS = '/opt/hermes-tasks/client.py'
LOCATION = '/opt/hermes-health/client.py'
DESTINATION = '238615548420255@lid'
MESSAGE = 'Tienes una tarea pendiente vinculada a este lugar. Revísala en Google Tasks; sigue pendiente hasta que la completes.'
MAX_AGE = 300
OUTSIDE_MAX_AGE = 900
NOTICE_VERSION = 1


def stamp(value):
    if type(value) in (int, float) and math.isfinite(value):
        return float(value)
    d = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if d.tzinfo is None:
        raise ValueError('Timezone required')
    return d.timestamp()


def valid_fix(fix, now):
    try:
        if fix['ok'] is not True or fix['person'] != 'dan':
            return False
        loc = fix['location']
        lat, lon, accuracy = (loc[k] for k in ('lat', 'lon', 'h_acc'))
        if any(type(v) not in (int, float) or not math.isfinite(v) for v in (lat, lon, accuracy)):
            return False
        recorded, received = stamp(loc['ts']), stamp(loc['received_at'])
        return (-90 <= lat <= 90 and -180 <= lon <= 180 and 0 <= accuracy <= 100
                and 0 <= now-recorded <= MAX_AGE and recorded <= received <= now and now-received <= MAX_AGE)
    except (KeyError, TypeError, ValueError, OverflowError):
        return False


def distance(loc, rule):
    a, b = math.radians(loc['lat']), math.radians(rule['latitude'])
    da, dl = b-a, math.radians(rule['longitude']-loc['lon'])
    return 6371000 * 2 * math.asin(min(1, math.sqrt(math.sin(da/2)**2 + math.cos(a)*math.cos(b)*math.sin(dl/2)**2)))


def identity(task):
    if task.get('owner') != 'Dani' or any(not isinstance(task.get(k), str) or not task[k] for k in ('listId', 'id')):
        raise ValueError('Canonical Dani identity required')
    return hashlib.sha256(json.dumps(['Dani', task['listId'], task['id']], separators=(',', ':')).encode()).hexdigest()


def active(task):
    # Missing status is not evidence of an open task.
    return task.get('done') is False and task.get('completed') in (None, '')


def delivery_body(item):
    key = hashlib.sha256(json.dumps(['Dani', item['listId'], item['id'], item['fingerprint'], item['episode']], separators=(',', ':')).encode()).hexdigest()
    return {'destination': DESTINATION, 'message': item.get('message', MESSAGE), 'idempotency_key': 'google-location:v1:' + key}


def cycle(state, tasks, latest, get_task, send, now=None, clock=time.time):
    candidates = {}
    for task in tasks:
        if task.get('owner') != 'Dani':
            continue
        key = identity(task)
        if key in candidates:
            raise ValueError('Duplicate canonical task')
        candidates[key] = task
    rules = {}
    for key, task in candidates.items():
        if not active(task):
            continue
        try:
            rule = parse(task.get('notes', ''))
        except ValueError:
            continue  # Invalid marked rules fail closed; no notes in logs.
        if rule:
            rules[key] = rule
    # Preserve all consumed/unknown evidence indefinitely, even after removal/done.
    for key, item in state.data['items'].items():
        if key not in rules and item['delivery'] in ('idle', 'retry'):
            item['delivery'] = 'stopped'
    state.save()
    if not rules:
        return {'rules': 0, 'sent': 0}
    fix = latest()
    now = clock() if now is None else now
    valid = valid_fix(fix, now)
    sent = 0
    for key, rule in rules.items():
        task = candidates[key]
        fp = fingerprint(rule)
        item = state.data['items'].get(key)
        if item and item['delivery'] in ('sent', 'failed', 'stopped'):
            continue
        if item and item['fingerprint'] != fp:
            if item['delivery'] != 'idle':
                item['delivery'] = 'stopped' if item['delivery'] == 'retry' else item['delivery']
                continue
            item.update(fingerprint=fp, phase=None, lastfix=0, outside_at=0)
        if item is None:
            item = {'listId': task['listId'], 'id': task['id'], 'fingerprint': fp,
                    'phase': None, 'lastfix': 0, 'outside_at': 0, 'delivery': 'idle', 'attempts': 0, 'episode': 0}
            state.data['items'][key] = item
        if item['delivery'] == 'idle' and valid:
            loc = fix['location']
            ts = stamp(loc['ts'])
            if ts <= item['lastfix']:
                continue
            outside_at = item.get('outside_at', 0)
            previous = 'outside' if outside_at and 0 <= now-outside_at <= OUTSIDE_MAX_AGE else None
            d, accuracy = distance(loc, rule), loc['h_acc']
            phase = previous
            if d+accuracy <= rule['radius']:
                phase = 'inside'
            elif d-accuracy >= rule['radius'] + max(50, rule['radius']*.25):
                phase = 'outside'
                item['outside_at'] = ts
            item.update(phase=phase, lastfix=ts)
            if phase == 'inside' and (previous == 'outside' or rule['nearby']):
                item.update(delivery='retry', episode=1)
            if phase == 'inside':
                item['outside_at'] = 0
        state.save()
        if item['delivery'] not in ('retry', 'unknown'):
            continue
        # Re-fetch exact task immediately before transport; identity never depends on list names/title.
        current = get_task(task['id'])
        try:
            unchanged = (identity(current) == key and active(current)
                         and fingerprint(parse(current.get('notes', ''))) == fp)
        except (ValueError, TypeError):
            unchanged = False
        if not unchanged:
            if item['delivery'] == 'retry':
                item['delivery'] = 'stopped'
            state.save()
            continue
        was_unknown = item['delivery'] == 'unknown'
        if item['delivery'] == 'retry':
            if item['attempts'] >= 3:
                item['delivery'] = 'failed'
                state.save()
                continue
            item['attempts'] += 1
        # Atomic durable claim BEFORE transport. A killed process remains unknown.
        if 'message' not in item and item['delivery'] == 'retry' and item['attempts'] == 1:
            title = current.get('title', '')
            title = ' '.join(title.split())[:200] if isinstance(title, str) else ''
            item['notice_version'] = NOTICE_VERSION
            item['message'] = (f'Tarea pendiente: {title or "Sin título"}. '
                               f'Google Tasks — lista {item["listId"]}, tarea {item["id"]}. '
                               'Sigue pendiente hasta que la completes.')
        item['delivery'] = 'unknown'
        state.save()
        result = send(delivery_body(item))
        if result == 'acknowledged':
            item['delivery'] = 'sent'
            sent += 1
        elif result == 'unavailable':
            # Explicit bridge 503 unavailable means no journal reservation/socket send.
            item['delivery'] = 'unknown' if was_unknown else 'retry' if item['attempts'] < 3 else 'failed'
        elif result != 'unknown':
            raise ValueError('Unsupported receipt result')
        state.save()
    state.save()
    return {'rules': len(rules), 'sent': sent}


class Runtime:
    """One bounded process group at a time; fixture clients are explicit offline paths."""
    def __init__(self, config):
        self.config = config
        self.deadline = time.monotonic() + 165
        self.child = None

    def call(self, command, payload=None, timeout=40):
        remaining = min(timeout, self.deadline-time.monotonic())
        if remaining <= 0:
            raise TimeoutError('Cycle budget exhausted')
        self.child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True, start_new_session=True)
        try:
            stdout, _ = self.child.communicate(None if payload is None else json.dumps(payload), timeout=remaining)
            return self.child.returncode, stdout
        finally:
            if self.child.poll() is None:
                import os
                os.killpg(self.child.pid, signal.SIGKILL)
                self.child.wait()
            self.child = None

    def tasks(self, action, payload):
        code, output = self.call([sys.executable, self.config.get('tasks_client', TASKS), action], payload)
        if code:
            raise ValueError('Tasks broker unavailable')
        return json.loads(output)

    def latest(self):
        code, output = self.call([sys.executable, self.config.get('location_client', LOCATION), 'where', 'dan', '--tz', 'Europe/Madrid'])
        if code:
            return None
        return json.loads(output)

    def send(self, body):
        try:
            code, _ = self.call([sys.executable, self.config['sender']], body, 25)
        except (TimeoutError, subprocess.TimeoutExpired):
            return 'unknown'
        return 'acknowledged' if code == 0 else 'unavailable' if code == 75 else 'unknown'


def run(config, initialize=False, clock=time.time):
    if initialize:
        if config.get('enabled') is not False:
            raise ValueError('Initialize only a disabled new install')
        with State(config['state'], initialize=True):
            return {'initialized': True}
    if config.get('enabled') is not True:
        return {'skipped': 'disabled'}
    if config.get('interval_seconds') != 300:
        raise ValueError('Five-minute cadence required')
    sender = config.get('sender')
    if not isinstance(sender, str) or not Path(sender).is_absolute() or not Path(sender).is_file():
        raise ValueError('Reviewed absolute sender script required')
    runtime = Runtime(config)
    def stop(signum, frame):
        if runtime.child:
            import os
            os.killpg(runtime.child.pid, signal.SIGKILL)
        raise SystemExit(128+signum)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    with State(config['state']) as state:
        tasks = runtime.tasks('list', {'owner': 'Dani', 'includeDone': False})['tasks']
        return cycle(state, tasks, runtime.latest,
                     lambda task_id: runtime.tasks('get', {'id': task_id})['task'], runtime.send, clock=clock)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--initialize-state', action='store_true')
    parser.add_argument('--quiet', action='store_true')
    args = parser.parse_args()
    try:
        result = run(json.loads(args.config.read_text()), args.initialize_state)
        if not args.quiet:
            print(json.dumps(result))
    except Exception:
        print('Location notes cycle stopped; no success confirmed.', file=sys.stderr)
        sys.exit(1)
