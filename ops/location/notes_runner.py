#!/usr/bin/env python3
"""Google notes -> read-only location evidence -> approved receipt adapter."""
import argparse
from datetime import datetime, timezone
import hashlib
from itertools import groupby
import json
import math
from pathlib import Path
import signal
import subprocess
import sys
import time

from google_notes import parse, fingerprint, trigger, due_stamp
from notes_state import State

TASKS = '/opt/hermes-tasks/client.py'
LOCATION = '/opt/hermes-health/client.py'
DESTINATION = '238615548420255@lid'
MESSAGE = 'Tienes una tarea pendiente vinculada a este lugar. Revísala en Google Tasks; sigue pendiente hasta que la completes.'
MAX_AGE = 300
OUTSIDE_MAX_AGE = 900
NOTICE_VERSION = 1
HISTORY_LIMIT = 200
STATIONARY_LOOKBACK = 7200


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


def presence(fix, fence, now):
    try:
        if fix['ok'] is not True or fix['person'] != 'dan':
            return 'uncertain'
        loc = fix['location']
        values = [loc[k] for k in ('lat', 'lon', 'h_acc')]
        if any(type(v) not in (int, float) or not math.isfinite(v) for v in values):
            return 'uncertain'
        lat, lon, accuracy = values
        ts, received = stamp(loc['ts']), stamp(loc['received_at'])
        if not all(math.isfinite(v) for v in (ts, received, now)) or not 0 <= ts <= received <= now or not -90 <= lat <= 90 or not -180 <= lon <= 180 or not 0 <= accuracy <= 100:
            return 'uncertain'
        if now-ts > 300 or now-received > 300:
            return 'stale'
        d = distance(loc, fence)
        return 'inside' if d+accuracy <= fence['radius'] else 'outside' if d-accuracy > fence['radius'] else 'uncertain'
    except (KeyError, TypeError, ValueError, OverflowError, AttributeError):
        return 'uncertain'



def continuing_presence(fix, rule, now, evidence):
    """Limited inference only; no stored GPS, no visit_arrival fallback."""
    result = presence(fix, rule, now)
    if result != 'stale' or evidence is None:
        return result
    try:
        loc = fix['location']
        ts = stamp(loc['ts'])
        if now-ts > 7200 or loc.get('motion') != 'stationary' or distance(loc, rule)+loc['h_acc'] > rule['radius']:
            return 'stale'
        # Provider failures propagate to cron; malformed evidence remains uncertain.
        persons, history = evidence(ts-STATIONARY_LOOKBACK, now)
        if not isinstance(persons, dict) or persons.get('ok') is not True or not isinstance(persons.get('persons'), list):
            return 'uncertain'
        matching = [p for p in persons['persons'] if isinstance(p, dict) and p.get('person') == 'dan']
        if len(matching) != 1:
            return 'uncertain'
        person = matching[0]
        upload = stamp(person['last_upload_at'])
        if stamp(person['last_location_ts']) != ts:
            return 'uncertain'
        devices = person['devices']
        if not isinstance(devices, list) or any(not isinstance(d, dict) or type(d.get('revoked')) is not bool for d in devices):
            return 'uncertain'
        active_devices = [d for d in devices if d['revoked'] is False]
        # Broker fixes are person-scoped: this is contact evidence, not a device binding.
        if len(active_devices) != 1 or not isinstance(active_devices[0].get('label'), str) or not active_devices[0]['label'].strip():
            return 'uncertain'
        seen = stamp(active_devices[0]['last_seen'])
        if not ts <= seen <= now or now-seen > 900:
            return 'stale'
        if not stamp(loc['received_at']) <= upload <= now or now-upload > 900:
            return 'stale'
        if not isinstance(history, dict) or history.get('ok') is not True or history.get('person') != 'dan':
            return 'uncertain'
        rows = history['locations']
        if (not isinstance(rows, list) or history.get('truncated', False) is not False
                or history.get('has_more', False) is not False
                or type(history.get('count')) is not int or history['count'] != len(rows)
                or history['count'] >= HISTORY_LIMIT):
            return 'uncertain'
        points = []
        event_ids = {}
        for row in rows:
            if row.get('id') is not None:
                event_id = row['id']
                if not isinstance(event_id, str) or not event_id:
                    return 'uncertain'
                if event_id in event_ids:
                    if row != event_ids[event_id]:
                        return 'uncertain'
                    continue
                event_ids[event_id] = row
            recorded, received = stamp(row['ts']), stamp(row['received_at'])
            if not ts-STATIONARY_LOOKBACK <= recorded <= now or not recorded <= received <= now:
                return 'uncertain'
            checked = {**row, 'received_at': recorded}
            if not valid_fix({'ok': True, 'person': 'dan', 'location': checked}, recorded):
                return 'uncertain'
            # Event time governs movement; a late-uploaded old trip cannot supersede a newer fix.
            if recorded >= ts and (row.get('motion') != 'stationary' or distance(row, rule)+row['h_acc'] > rule['radius']):
                return 'uncertain'
            if row.get('motion') == 'stationary' and distance(row, rule)+row['h_acc'] <= rule['radius']:
                points.append(recorded)
        # Group repeated timestamps and bursts, counting backwards from the latest fix.
        separated = []
        for recorded in sorted(set(points), reverse=True):
            if not separated or separated[-1]-recorded >= 300:
                separated.append(recorded)
        if len(separated) < 3 or separated[0] != ts or separated[0]-separated[-1] < 1800:
            return 'stale'
        return 'inferred_inside'
    except (KeyError, TypeError, ValueError, StopIteration, OverflowError, AttributeError):
        return 'uncertain'


def arrival_rows(value, start, end):
    """Validate completeness before using any event; retain rows in memory only."""
    try:
        if (not isinstance(value, dict) or value.get('ok') is not True
                or value.get('person') != 'dan' or value.get('tz') != 'Europe/Madrid'
                or value.get('truncated', False) is not False
                or value.get('has_more', False) is not False):
            return None
        rows = value['locations']
        if (not isinstance(rows, list) or not rows or type(value.get('count')) is not int
                or value['count'] != len(rows) or len(rows) >= HISTORY_LIMIT):
            return None
        checked = []
        event_ids = {}
        for row in rows:
            ts, received = stamp(row['ts']), stamp(row['received_at'])
            coords = [row[k] for k in ('lat', 'lon', 'h_acc')]
            if (not all(math.isfinite(v) for v in (ts, received))
                    or not 0 <= start <= ts <= received <= end
                    or any(type(v) not in (int, float) or not math.isfinite(v) for v in coords)
                    or not -90 <= coords[0] <= 90 or not -180 <= coords[1] <= 180 or coords[2] < 0):
                return None
            event_id = row.get('id')
            if event_id is not None:
                if not isinstance(event_id, str) or not event_id:
                    return None
                if event_id in event_ids:
                    if event_ids[event_id] != row:
                        return None
                    continue
                event_ids[event_id] = row
            checked.append((ts, row))
        return sorted(checked, key=lambda pair: pair[0])
    except (KeyError, TypeError, ValueError, OverflowError, AttributeError):
        return None


def canonical_updated(task, now):
    """Return a valid canonical authorization timestamp, or fail closed."""
    try:
        value = task['updated']
        if not isinstance(value, str):
            return None
        updated = stamp(value)
        return updated if math.isfinite(updated) and 0 < updated <= now else None
    except (KeyError, TypeError, ValueError, OverflowError):
        return None


def initial_history_update(item, task, rule, now):
    same_rule = item.get('fingerprint') == fingerprint(rule)
    if (trigger(rule) == {'type': 'arrival', 'nearby': False}
            and item.get('delivery', 'idle') == 'idle'
            and item.get('episode', 0) == 0 and item.get('attempts', 0) == 0
            and (not same_rule or 'history_checked' not in item)
            and not {'dispatch', 'legacy_body', 'message', 'notice_version',
                     'invalid_rule', 'evaluated_at', 'due_at', 'outcome'} & item.keys()):
        return canonical_updated(task, now)
    return None


def arrival_floor(item, task, rule, now):
    """Bound replay using unchanged ledger evidence or canonical rule age."""
    same_rule = item.get('fingerprint') == fingerprint(rule)
    anchor = item.get('outside_at', 0) if same_rule else 0
    start = (item.get('history_after', anchor if anchor and
                      0 <= now-anchor <= STATIONARY_LOOKBACK else now)
             if same_rule else now)
    updated = initial_history_update(item, task, rule, now)
    if updated is not None:
        start = min(start, updated)
    return max(0, now-STATIONARY_LOOKBACK, start)


def arrival_history(item, rule, rows, now):
    """Replay observation-time transitions, never treating backlog as current presence.

    Overlap the whole bounded anchor window to recover late received events and
    same-second samples. Claims consume the episode before any subsequent read.
    """
    floor = max(now-STATIONARY_LOOKBACK, item['history_after'])
    outside = item.get('outside_at', 0)
    outside = outside if max(0, now-STATIONARY_LOOKBACK) <= outside <= now else 0
    arrived = False
    newest = item['lastfix']
    phase = item['phase']
    last_observed = 0
    for ts, group in groupby(rows, key=lambda pair: pair[0]):
        if ts < floor:
            continue
        classifications = set()
        for _, loc in group:
            if loc['h_acc'] > 100:
                continue
            # Preserve the existing phone-sample policy; visits are excluded.
            if loc.get('kind', 'location') not in ('location', 'significant', 'trip', 'fence'):
                continue
            d = distance(loc, rule)
            observed = ('inside' if d+loc['h_acc'] <= rule['radius'] else
                        'outside' if d-loc['h_acc'] >= rule['radius']+max(50, rule['radius']*.25) else None)
            if observed:
                classifications.add(observed)
        # Contradictory precise evidence has no chronological ordering. Neither
        # side may claim arrival or change phase/baseline; uncertainty retains
        # the real anchor. Coarse/ambiguous rows cannot mask precise evidence.
        if len(classifications) != 1:
            continue
        observed = classifications.pop()
        if observed:
            last_observed = ts
        if observed == 'outside':
            outside = ts
        elif observed == 'inside':
            if (outside and 0 < ts-outside <= OUTSIDE_MAX_AGE) or trigger(rule)['nearby']:
                arrived = True
            outside = 0
        # Update phase only from an unambiguous timestamp classification.
        if ts >= newest and observed:
            newest, phase = ts, observed
    if last_observed < item['lastfix']:
        outside = item.get('outside_at', 0)
    item.update(lastfix=max(item['lastfix'], newest), phase=phase,
                outside_at=outside, history_checked=now)
    if arrived:
        item.update(delivery='retry', episode=1)


def identity(task):
    if not isinstance(task, dict) or task.get('owner') != 'Dani' or any(not isinstance(task.get(k), str) or not task[k] for k in ('listId', 'id')):
        raise ValueError('Canonical Dani identity required')
    return hashlib.sha256(json.dumps(['Dani', task['listId'], task['id']], separators=(',', ':')).encode()).hexdigest()


def active(task):
    # Missing status is not evidence of an open task.
    return task.get('deleted') is not True and task.get('done') is False and task.get('completed') in (None, '')


def delivery_body(item):
    if 'dispatch' in item:
        body = item['dispatch']['body']
        # JSON ledger saves sort keys; restore stable wire field order on restart.
        if item['dispatch']['transport'] == 'group':
            p = body['component']
            return {'key': body['key'], 'destination': body['destination'],
                    'component': {'id': p['id'], 'kind': p['kind'], 'content': p['content']}}
        return {'destination': body['destination'], 'message': body['message'],
                'idempotency_key': body['idempotency_key']}
    key = hashlib.sha256(json.dumps(['Dani', item['listId'], item['id'], item['fingerprint'], item['episode']], separators=(',', ':')).encode()).hexdigest()
    if 'legacy_body' in item:
        return item['legacy_body']
    return {'destination': DESTINATION, 'message': item.get('message', MESSAGE), 'idempotency_key': 'google-location:v1:' + key}


def cycle(state, tasks, latest, get_task, send, now=None, clock=time.time, evidence=None, fail_unresolved=False, history=None):
    candidates = {}
    for task in tasks:
        if task.get('owner') != 'Dani':
            continue
        key = identity(task)
        if key in candidates:
            raise ValueError('Duplicate canonical task')
        candidates[key] = task
    supplied_now = now
    rules = {}
    invalid = {}
    for key, task in candidates.items():
        if not active(task):
            continue
        try:
            rule = parse(task.get('notes', ''))
        except (ValueError, TypeError):
            invalid[key] = hashlib.sha256(task.get('notes', '').encode()).hexdigest()
            continue
        if rule:
            rules[key] = rule
    # Preserve all consumed/unknown evidence indefinitely, even after removal/done.
    for key, item in state.data['items'].items():
        if key not in rules and key not in invalid and item['delivery'] in ('idle', 'retry'):
            item['delivery'] = 'stopped'
    state.save()
    for key, fp in invalid.items():
        if key not in state.data['items'] or state.data['items'][key]['delivery'] == 'idle':
            task = candidates[key]
            state.data['items'][key] = {'listId': task['listId'], 'id': task['id'], 'fingerprint': fp, 'phase': None, 'lastfix': 0, 'delivery': 'retry', 'attempts': 0, 'episode': 1, 'message': 'La regla de ubicación de esta tarea es inválida; revisa sus notas en Google Tasks.', 'notice_version': 1, 'invalid_rule': True}
    if now is None and any(trigger(r)['type'] == 'presence_at' for r in rules.values()):
        now = clock()
    due_rules = {k: r for k, r in rules.items() if trigger(r)['type'] == 'arrival' or due_stamp(trigger(r)['dueAt']) <= now}
    # A removed, never-claimed arrival may accept a new configuration. Claims
    # remain terminal; old outside evidence must never trigger the new rule.
    for key, rule in due_rules.items():
        item = state.data['items'].get(key)
        if (item and item['delivery'] == 'stopped'
                and item['episode'] == 0 and item['attempts'] == 0
                and not {'dispatch', 'legacy_body', 'message', 'notice_version',
                         'invalid_rule', 'evaluated_at', 'due_at', 'outcome'} & item.keys()
                and trigger(rule) == {'type': 'arrival', 'nearby': False}
                and item['fingerprint'] != fingerprint(rule)):
            item.update(delivery='idle', fingerprint=fingerprint(rule),
                        phase=None, lastfix=0, outside_at=0)
            item.pop('history_after', None)
            item.pop('history_checked', None)
    state.save()
    needs_fix = any(state.data['items'].get(k, {}).get('delivery', 'idle') == 'idle'
                    and (history is None or trigger(r)['type'] == 'presence_at')
                    for k, r in due_rules.items())
    fix = latest() if needs_fix else None
    now = clock() if supplied_now is None else supplied_now
    valid = valid_fix(fix, now)
    # Share one bounded read, starting at the earliest eligible authorization or
    # real legacy outside anchor. A lastfix cursor would lose late uploads.
    history_starts = []
    if history:
        for key, rule in due_rules.items():
            item = state.data['items'].get(key, {})
            if item.get('delivery', 'idle') != 'idle' or trigger(rule)['type'] != 'arrival':
                continue
            history_starts.append(arrival_floor(item, candidates[key], rule, now))
    history_start = min(history_starts, default=now)
    history_cache = None
    history_read = False
    sent = 0
    for key in list(due_rules) + list(invalid):
        rule = rules.get(key)
        task = candidates[key]
        fp = fingerprint(rule) if rule else invalid[key]
        item = state.data['items'].get(key)
        if item and item['delivery'] in ('sent', 'failed', 'stopped'):
            continue
        if item and item['fingerprint'] != fp:
            if item['delivery'] != 'idle':
                item['delivery'] = 'stopped' if item['delivery'] == 'retry' else item['delivery']
                continue
            item.update(fingerprint=fp, phase=None, lastfix=0, outside_at=0)
            item.pop('history_after', None)
            item.pop('history_checked', None)
        if item is None:
            item = {'listId': task['listId'], 'id': task['id'], 'fingerprint': fp,
                    'phase': None, 'lastfix': 0, 'outside_at': 0, 'delivery': 'idle', 'attempts': 0, 'episode': 0}
            state.data['items'][key] = item
        if item['delivery'] == 'idle' and trigger(rule)['type'] == 'presence_at':
            captured = []
            def read_evidence(start, end):
                value = evidence(start, end)
                captured.append(value)
                return value
            outcome = continuing_presence(fix, rule, now, read_evidence if evidence else None)
            if supplied_now is None:
                now = clock()
                # Recheck age at actual evaluation completion, without another broker read.
                outcome = continuing_presence(fix, rule, now, (lambda *_: captured[-1]) if captured else None)
            title = ' '.join(str(task.get('title', 'Sin título')).split())[:200]
            text = {'inside': 'La ubicación reciente confirma presencia en el lugar.', 'inferred_inside': 'Según el último registro y el contacto reciente del dispositivo, parece que sigues en el lugar.', 'outside': 'La ubicación indica que estás fuera; no se cumple la condición.', 'stale': 'No pude confirmar presencia: registro antiguo o dispositivo sin contacto reciente.', 'uncertain': 'No pude confirmar presencia con suficiente fiabilidad.'}[outcome]
            item.update(delivery='retry', episode=1, evaluated_at=now, outcome=outcome, due_at=due_stamp(trigger(rule)['dueAt']), message=f'{text} Lugar: {rule["name"]}. Tarea: {title}. Evaluada a las {datetime.fromtimestamp(now).astimezone().isoformat()}.', notice_version=1)
        recovery_updated = None
        use_history = False
        if history and item['delivery'] == 'idle' and trigger(rule)['type'] == 'arrival':
            if 'history_after' not in item or 'history_checked' not in item:
                recovery_updated = initial_history_update(item, task, rule, now)
                item['history_after'] = arrival_floor(item, task, rule, now)
            use_history = True
            if not history_read:
                history_read = True
                history_cache = arrival_rows(history(history_start, now), history_start, now)
            if supplied_now is None:
                now = clock()
            if history_cache is not None:
                arrival_history(item, rule, history_cache, now)
        if item['delivery'] == 'idle' and valid and not use_history:
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
            if phase == 'inside' and (previous == 'outside' or trigger(rule)['nearby']):
                item.update(delivery='retry', episode=1)
            if phase == 'inside':
                item['outside_at'] = 0
        # Keep an initial recovery provisional until its final canonical GET.
        # A crash here leaves the prior idle ledger, so it cannot bypass the fence.
        if recovery_updated is None or item['delivery'] != 'retry':
            state.save()
        if item['delivery'] not in ('retry', 'unknown'):
            continue
        # Re-fetch exact task immediately before transport; identity never depends on list names/title.
        current = get_task(task['id'])
        try:
            unchanged = (identity(current) == key and active(current)
                         and ((item.get('invalid_rule') and hashlib.sha256(current.get('notes', '').encode()).hexdigest() == fp)
                              or not item.get('invalid_rule') and fingerprint(parse(current.get('notes', ''))) == fp))
        except (ValueError, TypeError):
            unchanged = False
        if not unchanged:
            if item['delivery'] == 'retry':
                item['delivery'] = 'stopped'
            state.save()
            continue
        # Fence only initial recovery that has never frozen a transport claim.
        if (recovery_updated is not None and item['delivery'] == 'retry'
                and item['attempts'] == 0 and 'dispatch' not in item
                and 'legacy_body' not in item
                and canonical_updated(current, now) != recovery_updated):
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
        if 'message' not in item and item['delivery'] == 'retry' and item['attempts'] == 1 and not (rule and 'delivery' in rule):
            title = current.get('title', '')
            title = ' '.join(title.split())[:200] if isinstance(title, str) else ''
            item['notice_version'] = NOTICE_VERSION
            item['message'] = (f'Tarea pendiente: {title or "Sin título"}. '
                               f'Google Tasks — lista {item["listId"]}, tarea {item["id"]}. '
                               'Sigue pendiente hasta que la completes.')
        if 'dispatch' not in item:
            from delivery import snapshot, explicit_body
            body = explicit_body(item, rule['delivery']) if rule and 'delivery' in rule and not was_unknown else delivery_body(item)
            item['dispatch'] = snapshot(body)
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
    unresolved = any(i['delivery'] in ('unknown', 'retry', 'failed') for i in state.data['items'].values())
    if unresolved and fail_unresolved:
        raise RuntimeError('Private delivery unresolved; may have been received; durable key retained')
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
            raise RuntimeError('Location broker unavailable')
        result = json.loads(output)
        if not isinstance(result, dict) or result.get('ok') is not True:
            raise RuntimeError('Location broker unavailable')
        return result

    def history(self, start, end):
        code, output = self.call([sys.executable, self.config.get('location_client', LOCATION),
            'locations', 'dan', '--from', datetime.fromtimestamp(start, timezone.utc).isoformat(),
            '--to', datetime.fromtimestamp(end, timezone.utc).isoformat(),
            '--tz', 'Europe/Madrid', '--limit', str(HISTORY_LIMIT), '--order', 'asc'])
        if code:
            raise RuntimeError('Location broker unavailable')
        try:
            return json.loads(output)
        except ValueError as exc:
            raise RuntimeError('Location broker invalid response') from exc

    def evidence(self, start, end):
        def read(args):
            code, output = self.call([sys.executable, self.config.get('location_client', LOCATION), *args])
            if code:
                raise RuntimeError('Location broker unavailable')
            try:
                result = json.loads(output)
            except ValueError as exc:
                raise RuntimeError('Location broker invalid response') from exc
            if not isinstance(result, dict) or result.get('ok') is not True:
                raise RuntimeError('Location broker unavailable')
            return result
        return read(['persons']), read(['locations', 'dan', '--from', datetime.fromtimestamp(start).astimezone().isoformat(), '--to', datetime.fromtimestamp(end).astimezone().isoformat(), '--limit', str(HISTORY_LIMIT), '--order', 'asc'])

    def send(self, body):
        try:
            code, _ = self.call([sys.executable, str(Path(__file__).with_name('delivery.py')) if 'component' in body else self.config['sender']], body, 25)
        except (TimeoutError, subprocess.TimeoutExpired):
            return 'unknown'
        return 'acknowledged' if code == 0 else 'unavailable' if code == 75 else 'unknown'


def run(config, initialize=False, clock=time.time):
    if not isinstance(config, dict) or set(config) - {'enabled', 'interval_seconds', 'state', 'sender', 'tasks_client', 'location_client'}:
        raise ValueError('Generic notes runtime configuration required')
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
                     lambda task_id: runtime.tasks('get', {'id': task_id})['task'], runtime.send, clock=clock, evidence=runtime.evidence, fail_unresolved=True, history=runtime.history)


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
