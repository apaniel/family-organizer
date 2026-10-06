import copy
import hashlib
import json
import multiprocessing
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from google_notes import parse, update_notes, fingerprint
from notes_state import State
from notes_runner import cycle, delivery_body, identity, run, valid_fix
from author_notes import author
from private_sender import send, Unavailable

ROOT = Path(__file__).parent
NOW = 1791260000
RULE = {'version': 1, 'revision': 1, 'name': 'Horitzo', 'address': 'Passeig Bonanova 7',
        'mapsUrl': 'https://www.google.com/maps?q=41.40602887575433,2.1323827894099114',
        'latitude': 41.40602887575433, 'longitude': 2.1323827894099114, 'radius': 150, 'nearby': False}
TASK = {'id': 'NnZKdzZtbkNoaVJwN205ZQ', 'listId': 'WHh4eXR1cG94dGRueW1VdQ', 'owner': 'Dani',
        'notes': update_notes('Original notes retained', RULE), 'sourceKey': 'whatsapp:location:test:horitzo:20261005',
        'title': 'SECRET TASK TITLE', 'done': False, 'completed': None}


def fix(outside=False, at=NOW, accuracy=10):
    return {'ok': True, 'person': 'dan', 'location': {'lat': RULE['latitude'] + (.004 if outside else 0),
            'lon': RULE['longitude'], 'h_acc': accuracy, 'ts': at, 'received_at': at}}


def child_claim(path, queue):
    try:
        with State(path):
            queue.put('acquired')
    except BlockingIOError:
        queue.put('locked')


class NotesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = Path(self.tmp.name)
        self.directory.chmod(0o700)
        self.path = self.directory/'state.json'
        with State(self.path, initialize=True):
            pass
        self.task = copy.deepcopy(TASK)
        self.receipts = []

    def tearDown(self):
        self.tmp.cleanup()

    def tick(self, f, send_fn=None, tasks=None, get=None):
        with State(self.path) as state:
            return cycle(state, [self.task] if tasks is None else tasks, lambda: f,
                         get or (lambda _: self.task), send_fn or self.sender, f['location']['received_at'])

    def sender(self, body):
        self.receipts.append(body)
        return 'acknowledged'

    def read(self):
        return json.loads(self.path.read_text())

    def item(self):
        return next(iter(self.read()['items'].values()))

    def test_arrival_and_restart_once_no_coordinates_title_or_notes(self):
        self.tick(fix(True))
        self.tick(fix(at=NOW+300))
        self.tick(fix(True, NOW+600))
        self.tick(fix(at=NOW+900))
        self.assertEqual(len(self.receipts), 1)
        self.assertEqual(self.item()['delivery'], 'sent')
        text = self.path.read_text()
        for secret in ('latitude', 'longitude', 'Horitzo', 'Original notes', 'sourceKey'):
            self.assertNotIn(secret, text)

    def test_first_inside_requires_explicit_nearby(self):
        self.tick(fix())
        self.assertFalse(self.receipts)
        self.task['notes'] = update_notes('', {**RULE, 'nearby': True})
        self.tick(fix(at=NOW+300))
        self.assertEqual(len(self.receipts), 1)

    def test_age_accuracy_order_edge_and_gap(self):
        for mutation in ({'h_acc': 101}, {'h_acc': float('nan')}, {'lat': 91}, {'ts': NOW-301}, {'ts': NOW+1}):
            f = fix(); f['location'].update(mutation)
            self.assertFalse(valid_fix(f, NOW))
        self.tick(fix(True))
        self.tick(fix(at=NOW-1))
        self.assertEqual(self.item()['lastfix'], NOW)
        edge = fix(at=NOW+100, accuracy=100)
        edge['location']['lat'] += .001
        self.tick(edge)
        self.assertFalse(self.receipts)
        self.tick(fix(at=NOW+901))
        self.assertFalse(self.receipts)  # Gap loses arrival evidence.

    def test_jitter_and_bounded_outside_evidence(self):
        for gap in (300.1, 301, 600, 900, 900.1):
            with State(self.path) as state:
                state.data['items'] = {}; state.save()
            self.receipts.clear()
            self.tick(fix(True))
            for t in (300, 600):
                if t < gap:
                    edge = fix(at=NOW+t, accuracy=100)
                    edge['location']['lat'] += .001
                    self.tick(edge)
            self.tick(fix(at=NOW+gap))
            self.assertEqual(len(self.receipts), int(gap <= 900))

    def test_read_clock_after_fix_and_future_rejection(self):
        for evaluated, expected in ((NOW+.2, 'outside'), (NOW, None)):
            with State(self.path) as state:
                state.data['items'] = {}; state.save()
                events = []
                def latest():
                    events.append('read'); return fix(True, NOW+.1)
                def clock():
                    self.assertEqual(events, ['read']); return evaluated
                cycle(state, [self.task], latest, lambda _: self.task, self.sender, clock=clock)
            self.assertEqual(self.item()['phase'], expected)

    def test_reserved_text_never_updates(self):
        class Broker:
            def tasks(inner, action, payload):
                self.assertEqual(action, 'get')
                return {'task': self.task}
        for field in ('name', 'address', 'mapsUrl'):
            for marker in ('[hermes-location:v1]', '[/hermes-location:v2]'):
                with self.assertRaises(ValueError):
                    author(Broker(), TASK['id'], TASK['listId'], {**RULE, 'revision': 2, field: RULE[field]+marker}, TASK['sourceKey'])

    def test_immutable_actionable_message_after_title_and_code_edit(self):
        self.tick(fix(True))
        self.tick(fix(at=NOW+301), send_fn=lambda body: self.receipts.append(body) or 'unknown')
        original = copy.deepcopy(self.receipts[0])
        self.task['title'] = 'Changed title'
        with patch('notes_runner.MESSAGE', 'Changed template'), patch('notes_runner.NOTICE_VERSION', 2):
            self.tick(fix(at=NOW+601))
        self.assertEqual(original, self.receipts[-1])
        self.assertIn(TASK['title'], original['message'])
        self.assertIn(TASK['id'], original['message'])
        other = {**TASK, 'id': 'another-task', 'title': 'Buy bread'}
        with State(self.path) as state:
            cycle(state, [other], lambda: fix(True, NOW+700), lambda _: other, self.sender, NOW+700)
            cycle(state, [other], lambda: fix(at=NOW+1001), lambda _: other, self.sender, NOW+1001)
        self.assertIn('Buy bread', self.receipts[-1]['message'])
        self.assertNotEqual(original['message'], self.receipts[-1]['message'])

    def test_changed_rule_requires_new_outside_baseline(self):
        self.tick(fix(True))
        self.task['notes'] = update_notes(self.task['notes'], {**RULE, 'revision': 2})
        self.tick(fix(at=NOW+300))
        self.assertFalse(self.receipts)
        self.tick(fix(True, NOW+600))
        self.tick(fix(at=NOW+900))
        self.assertEqual(len(self.receipts), 1)
        self.task['notes'] = update_notes(self.task['notes'], {**RULE, 'revision': 3})
        self.tick(fix(True, NOW+1200)); self.tick(fix(at=NOW+1500))
        self.assertEqual(len(self.receipts), 1)

    def test_done_or_changed_between_list_get_stops_delivery(self):
        for replacement in ({**self.task, 'done': True}, {**self.task, 'listId': 'another'}, {**self.task, 'notes': ''}):
            with State(self.path) as state:
                state.data['items'] = {}; state.save()
            self.tick(fix(True))
            self.tick(fix(at=NOW+300), get=lambda _: replacement)
            self.assertEqual(self.item()['delivery'], 'stopped')
        self.assertFalse(self.receipts)

    def test_empty_malformed_and_user_notes_no_broker_or_sender(self):
        for notes in ('', 'Please meet me outside and inside.'):
            task = {**self.task, 'notes': notes}
            with State(self.path) as state:
                cycle(state, [task], lambda: self.fail('location read'), lambda _: self.fail('get'), self.sender, NOW)
        self.assertFalse(self.receipts)

    def test_duplicate_identity_failclosed_and_list_rename_stable(self):
        with self.assertRaises(ValueError):
            self.tick(fix(), tasks=[self.task, self.task])
        self.tick(fix(True))
        self.task['listName'] = 'Renamed list'
        self.tick(fix(at=NOW+300))
        self.assertEqual(len(self.receipts), 1)

    def test_retries_bounded_across_restart(self):
        self.tick(fix(True))
        for n in range(1, 7):
            self.tick(fix(at=NOW+300*n), send_fn=lambda body: 'unavailable')
        self.assertEqual((self.item()['delivery'], self.item()['attempts']), ('failed', 3))

    def test_timeout_unknown_reconciles_same_key_and_survives_done(self):
        self.tick(fix(True))
        def uncertain(body):
            self.receipts.append(body)
            return 'unknown'
        self.tick(fix(at=NOW+300), send_fn=uncertain)
        self.tick(fix(at=NOW+600), send_fn=lambda _: 'unavailable')
        self.assertEqual(self.item()['delivery'], 'unknown')
        self.tick(fix(at=NOW+900), send_fn=uncertain)
        self.assertEqual(self.receipts[0], self.receipts[1])
        self.task['done'] = True
        with State(self.path) as state:
            cycle(state, [], lambda: self.fail(), lambda _: self.fail(), self.sender, NOW+10000000)
        self.assertEqual(self.item()['delivery'], 'unknown')

    def test_crash_after_send_before_save_preserves_unknown(self):
        self.tick(fix(True))
        def crash(body):
            self.receipts.append(body)
            raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):
            self.tick(fix(at=NOW+300), send_fn=crash)
        self.assertEqual(self.item()['delivery'], 'unknown')
        self.tick(fix(at=NOW+600))
        self.assertEqual(self.receipts[0], self.receipts[1])

    def test_claim_is_saved_before_transport_and_one_process(self):
        self.tick(fix(True))
        def claimed(body):
            self.assertEqual(self.item()['delivery'], 'unknown')
            queue = multiprocessing.Queue()
            child = multiprocessing.Process(target=child_claim, args=(str(self.path), queue))
            child.start(); child.join(3)
            self.assertEqual(queue.get(timeout=1), 'locked')
            return 'acknowledged'
        self.tick(fix(at=NOW+300), send_fn=claimed)

    def test_missing_corrupt_permissions_symlinks_failclosed(self):
        self.path.unlink()
        with self.assertRaises(FileNotFoundError): State(self.path)
        for text in ('{', '{}', '{"version":1,"items":{"bad":{}}}', '{"version":1,"items":{},"items":{}}'):
            self.path.write_text(text); self.path.chmod(0o600)
            with self.assertRaises(ValueError): State(self.path)
        self.path.write_text('{"version":1,"items":{}}'); self.path.chmod(0o644)
        with self.assertRaises(ValueError): State(self.path)
        self.path.unlink(); self.path.symlink_to('/dev/null')
        with self.assertRaises(OSError): State(self.path)
        self.path.unlink(); self.directory.chmod(0o755)
        with self.assertRaises(ValueError): State(self.path)
        self.directory.chmod(0o700)
        link = self.directory/'link'; link.symlink_to(self.directory, target_is_directory=True)
        with self.assertRaises(OSError): State(link/'new.json', initialize=True)

    def test_initialize_never_overwrites_and_disabled_does_nothing(self):
        with self.assertRaises(FileExistsError): State(self.path, initialize=True)
        with patch('notes_runner.Runtime', side_effect=AssertionError('runtime')):
            self.assertEqual(run({'enabled': False}), {'skipped': 'disabled'})

    def test_notes_roundtrip_preserves_metadata_and_unrelated_bytes(self):
        original = 'Unrelated\n\n#hermes key=whatsapp%3Alocation%3Atest&estado=esperando'
        notes = update_notes(original, RULE)
        self.assertTrue(notes.endswith(original.split('\n')[-1]))
        self.assertTrue(notes.startswith('Unrelated\n\n'))
        new = update_notes(notes, {**RULE, 'revision': 2, 'name': 'New place'})
        self.assertEqual(parse(new)['name'], 'New place')
        self.assertIn('Lugar: New place', new)
        self.assertNotIn('Lugar: Horitzo', new)
        self.assertTrue(new.endswith(original.split('\n')[-1]))
        for bad in (notes+notes, notes.replace('"nearby":false', '"nearby":null'), notes.replace('"version":1', '"version":1,"version":1')):
            with self.assertRaises(ValueError): parse(bad)

    def test_author_uses_notes_only_and_verifies_source(self):
        class Broker:
            def __init__(self): self.task = copy.deepcopy(TASK); self.calls = []
            def tasks(self, action, payload):
                self.calls.append((action, payload))
                if action == 'update': self.task.update(payload['task'])
                return {'task': copy.deepcopy(self.task)}
        broker = Broker()
        author(broker, TASK['id'], TASK['listId'], {**RULE, 'revision': 2}, TASK['sourceKey'])
        self.assertEqual([c[0] for c in broker.calls], ['get', 'update', 'get'])
        self.assertEqual(set(broker.calls[1][1]['task']), {'notes'})
        self.assertEqual(broker.task['sourceKey'], TASK['sourceKey'])
        with self.assertRaises(ValueError):
            author(broker, TASK['id'], 'wrong-list', {**RULE, 'revision': 3}, TASK['sourceKey'])


class SenderTests(unittest.TestCase):
    def response(self, status, body):
        class Response:
            def read(self, _): return json.dumps(body).encode()
        r = Response(); r.status = status
        class Connection:
            def request(self, method, route, payload, headers):
                assert method == 'POST' and route == '/family/private-notice'
            def getresponse(self): return r
            def close(self): pass
        return Connection()

    def test_unavailable_after_uncertain_remains_unknown(self):
        body = {'destination': '238615548420255@lid', 'message': 'Offline test', 'idempotency_key': 'test'}
        responses = iter([self.response(202, {'state': 'uncertain', 'messageId': 'id'}),
                          self.response(503, {'state': 'unavailable'})])
        with self.assertRaises(TimeoutError):
            send(body, connect=lambda: next(responses), sleep=lambda _: None)

    def test_definitive_unavailable_and_bad_receipt(self):
        body = {'destination': '238615548420255@lid', 'message': 'Offline test', 'idempotency_key': 'test'}
        with self.assertRaises(Unavailable):
            send(body, connect=lambda: self.response(503, {'state': 'unavailable'}))
        with self.assertRaises(ValueError):
            send(body, connect=lambda: self.response(200, {'state': 'uncertain', 'messageId': 'id'}))
        send(body, connect=lambda: self.response(200, {'state': 'acknowledged', 'messageId': 'id'}))


if __name__ == '__main__': unittest.main()
