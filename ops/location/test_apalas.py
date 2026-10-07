"""Offline opt-in group, private compatibility, immutable claim and author regressions."""
import copy
import json
import subprocess
import sys
import unittest
from unittest.mock import patch
import test_notes
from test_notes import TASK, RULE, NOW, fix, ROOT
from google_notes import parse, update_notes, fingerprint
from notes_state import State, validate
from notes_runner import delivery_body, Runtime
from author_notes import author
from delivery import GROUP, PRIVATE, send, validate_body, Unavailable


class ApalasTests(unittest.TestCase):
    setUp = test_notes.NotesTests.setUp
    tearDown = test_notes.NotesTests.tearDown
    tick = test_notes.NotesTests.tick
    sender = test_notes.NotesTests.sender
    read = test_notes.NotesTests.read
    item = test_notes.NotesTests.item

    def opt_in(self, destination=GROUP, message='Hola'):
        self.rule = {**RULE, 'revision': 2, 'delivery': {'destination': destination, 'message': message}}
        self.task['notes'] = update_notes(self.task['notes'], self.rule)

    def pause_and_author(self):
        self.tick(fix(True))
        self.task['notes'] = 'Original notes retained\n#hermes preserved=root'
        self.tick(fix(at=NOW+100))
        self.assertEqual(self.item()['delivery'], 'stopped')
        rule = {**RULE, 'version': 2, 'revision': 2, 'name': 'CASA',
                'address': 'Carrer de Laforja63 Barcelona',
                'latitude': 41.3970791, 'longitude': 2.1465232, 'radius': 100,
                'mapsUrl': 'https://maps.google.com/?q=41.3970791,2.1465232',
                'trigger': {'type': 'arrival', 'nearby': False},
                'delivery': {'destination': GROUP, 'message': 'Hola'}}
        rule.pop('nearby')
        class Broker:
            def tasks(inner, action, payload):
                if action == 'update': self.task.update(payload['task'])
                return {'task': copy.deepcopy(self.task)}
        self.assertTrue(author(Broker(), TASK['id'], TASK['listId'], rule,
                               TASK['sourceKey'], self.path)['verified'])
        self.assertTrue(self.task['notes'].startswith('Original notes retained\n'))
        self.assertEqual(parse(self.task['notes']), rule)
        self.assertTrue(self.task['notes'].endswith('#hermes preserved=root'))
        return rule

    def home_fix(self, outside=False, at=NOW+200):
        f = fix(at=at)
        f['location'].update(lat=41.3970791 + (.004 if outside else 0), lon=2.1465232)
        return f

    def test_paused_author_fresh_outside_inside_exact_hola(self):
        self.pause_and_author()
        self.tick(self.home_fix())
        self.assertFalse(self.receipts)  # Old outside baseline cannot carry over.
        self.tick(self.home_fix(True, NOW+300))
        self.tick(self.home_fix(at=NOW+400))
        self.assertEqual(len(self.receipts), 1)
        body = self.receipts[0]
        self.assertEqual(body, {'key': body['key'], 'destination': GROUP,
            'component': {'id': body['key'], 'kind': 'text', 'content': 'Hola'}})

    def test_paused_author_stale_fix_no_baseline(self):
        self.pause_and_author()
        f = self.home_fix(True)
        f['location']['ts'] = NOW-301
        self.tick(f)
        self.assertEqual((self.item()['phase'], self.item()['lastfix'],
                          self.item()['outside_at']), (None, 0, 0))
        self.tick(self.home_fix(at=NOW+300))
        self.assertFalse(self.receipts)

    def test_paused_nochange_malformed_no_resurrection(self):
        self.tick(fix(True))
        self.task['notes'] = 'Paused'
        self.tick(fix(at=NOW+100))
        stopped = self.item()
        for notes in (TASK['notes'], '[hermes-location:v2]bad[/hermes-location:v2]'):
            self.task['notes'] = notes
            self.tick(fix(at=NOW+200))
            self.assertEqual(self.item(), stopped)
        self.assertFalse(self.receipts)

    def test_claimed_stopped_and_other_terminal_evidence_never_resume(self):
        self.pause_and_author()
        base = self.item()
        for status, episode, attempts in (('stopped', 1, 1), ('stopped', 1, 0),
                                          ('failed', 1, 3), ('sent', 1, 1),
                                          ('unknown', 1, 1), ('retry', 1, 1)):
            with self.subTest(status=status, attempts=attempts):
                with State(self.path) as state:
                    item = next(iter(state.data['items'].values()))
                    item.update(base, delivery=status, episode=episode, attempts=attempts)
                    state.save()
                self.tick(self.home_fix())
                self.assertNotEqual(self.item()['delivery'], 'idle')
                self.assertEqual(self.item()['episode'], episode)
        self.assertFalse(self.receipts)

    def test_group_body_privacy_restart_ack_and_consumption(self):
        self.opt_in()
        self.tick(fix())
        self.assertFalse(self.receipts)
        self.tick(fix(True, NOW+300))
        self.tick(fix(at=NOW+600), send_fn=lambda b: self.receipts.append(copy.deepcopy(b)) or 'unknown')
        original = self.receipts[0]
        self.assertEqual(set(original), {'key', 'destination', 'component'})
        self.assertEqual(original['component'], {'id': original['key'], 'kind': 'text', 'content': 'Hola'})
        for sensitive in (TASK['title'], TASK['id'], TASK['listId'], RULE['name'], RULE['address'], RULE['mapsUrl'], str(RULE['latitude'])):
            self.assertNotIn(sensitive, json.dumps(original))
        self.assertNotIn('message', self.item())
        self.tick(fix(at=NOW+900), send_fn=lambda _: 'unavailable')
        self.assertEqual(self.item()['delivery'], 'unknown')
        self.tick(fix(at=NOW+1200))
        self.assertEqual(self.receipts[-1], original)
        self.task['notes'] = update_notes(self.task['notes'], {**self.rule, 'revision': 3})
        self.tick(fix(True, NOW+1500)); self.tick(fix(at=NOW+1800))
        self.assertEqual(len(self.receipts), 2)

    def test_changed_route_message_no_new_key(self):
        for delivery in ({'destination': PRIVATE, 'message': 'Hola'}, {'destination': GROUP, 'message': 'Otro'}):
            with State(self.path) as state:
                state.data['items'] = {}; state.save()
            self.task = copy.deepcopy(TASK); self.opt_in()
            self.tick(fix(True))
            self.tick(fix(at=NOW+300), send_fn=lambda b: self.receipts.append(b) or 'unknown')
            original = copy.deepcopy(self.item()['dispatch'])
            self.task['notes'] = update_notes(self.task['notes'], {**self.rule, 'revision': 3, 'delivery': delivery})
            self.tick(fix(at=NOW+600))
            self.assertEqual(self.item()['dispatch'], original)
            self.assertEqual(self.item()['delivery'], 'unknown')

    def test_crash_group_claim_and_old_claim_fallback(self):
        self.opt_in(); self.tick(fix(True))
        def crash(body):
            self.receipts.append(body)
            raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):
            self.tick(fix(at=NOW+300), send_fn=crash)
        self.tick(fix(at=NOW+600))
        self.assertEqual(self.receipts[0], self.receipts[1])
        with State(self.path) as state:
            state.data['items'] = {}; state.save()
        self.task = copy.deepcopy(TASK)
        self.tick(fix(True))
        self.tick(fix(at=NOW+300), send_fn=lambda _: 'unknown')
        with State(self.path) as state:
            item = next(iter(state.data['items'].values()))
            item.pop('dispatch'); item.pop('message'); item.pop('notice_version')
            old = delivery_body(item); state.save()
        self.tick(fix(at=NOW+600))
        self.assertEqual(self.receipts[-1], old)

    def test_parser_allowlist_boundaries_and_delimiters(self):
        for version in (1, 2):
            rule = {**RULE, 'delivery': {'destination': GROUP, 'message': 'Hola'}}
            if version == 2:
                rule.pop('nearby'); rule.update(version=2, trigger={'type': 'arrival', 'nearby': False})
            self.assertEqual(parse(update_notes('', rule)), rule)
            for destination, message in [('123@g.us', 'Hola'), (GROUP, ''), (GROUP, 'a'*2001), (GROUP, 'Hola\n'), (GROUP, '[hermes-location:v2]')]:
                with self.assertRaises(ValueError):
                    update_notes('', {**rule, 'delivery': {'destination': destination, 'message': message}})
            self.assertEqual(parse(update_notes('', {**rule, 'delivery': {'destination': GROUP, 'message': 'a'*2000}}))['delivery']['message'], 'a'*2000)

    def test_author_claim_check_and_narrow_narrative(self):
        class Broker:
            def __init__(inner): inner.task = copy.deepcopy(self.task); inner.writes = 0
            def tasks(inner, action, payload):
                if action == 'update': inner.task.update(payload['task']); inner.writes += 1
                return {'task': copy.deepcopy(inner.task)}
        self.opt_in(); rule = self.rule
        self.task = copy.deepcopy(TASK)
        self.task['notes'] += '\nPrivate erroneous narrative\n#hermes preserved=root'
        broker = Broker()
        author(broker, TASK['id'], TASK['listId'], rule, TASK['sourceKey'], self.path, 'Private erroneous narrative')
        self.assertIn('Original notes retained', broker.task['notes'])
        self.assertTrue(broker.task['notes'].endswith('#hermes preserved=root'))
        self.assertNotIn('Private erroneous narrative', broker.task['notes'])
        self.task = broker.task
        self.tick(fix(True)); self.tick(fix(at=NOW+300), send_fn=lambda _: 'unknown')
        for status in ('unknown', 'sent', 'retry'):
            with State(self.path) as state:
                next(iter(state.data['items'].values()))['delivery'] = status; state.save()
            with self.assertRaisesRegex(ValueError, 'already claimed'):
                author(broker, TASK['id'], TASK['listId'], {**rule, 'revision': 3, 'delivery': {'destination': PRIVATE, 'message': 'Hola'}}, TASK['sourceKey'], self.path)
        self.assertEqual(broker.writes, 1)
        result = subprocess.run([sys.executable, str(ROOT/'author_notes.py'), '--claim-status', '--state', str(self.path), '--id', TASK['id'], '--list-id', TASK['listId']], capture_output=True, text=True)
        self.assertEqual(result.stdout, 'claimed:retry\n')

    def test_explicit_private_and_exact_legacy_key(self):
        self.opt_in(PRIVATE, 'Hola')
        self.tick(fix(True)); self.tick(fix(at=NOW+300))
        self.assertEqual(set(self.receipts[0]), {'destination', 'message', 'idempotency_key'})
        self.assertEqual(self.receipts[0]['destination'], PRIVATE)
        self.assertEqual(self.receipts[0]['message'], 'Hola')
        import hashlib
        item = {'listId': TASK['listId'], 'id': TASK['id'], 'fingerprint': fingerprint(RULE), 'episode': 1}
        key = hashlib.sha256(json.dumps(['Dani', item['listId'], item['id'], item['fingerprint'], 1], separators=(',', ':')).encode()).hexdigest()
        from notes_runner import MESSAGE
        self.assertEqual(delivery_body(item), {'destination': PRIVATE, 'message': MESSAGE, 'idempotency_key': 'google-location:v1:' + key})

    def test_group_definitive_attempts_bounded_same_body(self):
        self.opt_in(); self.tick(fix(True))
        def unavailable(body):
            self.receipts.append(body)
            return 'unavailable'
        for n in range(1, 6):
            self.tick(fix(at=NOW+300*n), send_fn=unavailable)
        self.assertEqual((self.item()['delivery'], self.item()['attempts']), ('failed', 3))
        self.assertEqual(len(self.receipts), 3)
        self.assertTrue(all(body == self.receipts[0] for body in self.receipts))

    def test_author_rejects_original_private_claim_opt_in(self):
        self.tick(fix(True)); self.tick(fix(at=NOW+300), send_fn=lambda _: 'unknown')
        class Broker:
            def tasks(inner, action, payload):
                self.assertEqual(action, 'get')
                return {'task': copy.deepcopy(self.task)}
        with self.assertRaisesRegex(ValueError, 'already claimed'):
            author(Broker(), TASK['id'], TASK['listId'], {**RULE, 'revision': 2,
                'delivery': {'destination': GROUP, 'message': 'Hola'}}, TASK['sourceKey'], self.path)
        self.assertEqual(self.item()['delivery'], 'unknown')

    def test_readonly_state_preserved_and_missing_lock_refused(self):
        before = self.path.read_bytes()
        with State(self.path, readonly=True) as state:
            with self.assertRaises(ValueError): state.save()
        self.assertEqual(self.path.read_bytes(), before)
        lock = self.path.with_name(self.path.name + '.lock')
        lock.unlink()
        with self.assertRaises(FileNotFoundError): State(self.path, readonly=True)
        self.assertFalse(lock.exists())

    def test_runtime_routes_and_serialization(self):
        self.opt_in(); self.tick(fix(True)); self.tick(fix(at=NOW+300))
        validate(json.loads(self.path.read_text()))
        runtime = Runtime({'sender': str(ROOT/'private_sender.py')})
        with patch.object(runtime, 'call', return_value=(0, '')) as call:
            runtime.send(self.receipts[0])
            self.assertEqual(call.call_args.args[0][-1], str(ROOT/'delivery.py'))
        with self.assertRaises(ValueError):
            validate_body({**self.receipts[0], 'destination': PRIVATE})


class GroupSenderTests(unittest.TestCase):
    def connection(self, status, body):
        outer = self
        class Response:
            def read(self, _): return json.dumps(body).encode()
        r = Response(); r.status = status
        class Connection:
            def request(self, method, route, payload, headers): outer.requests.append((method, route, payload))
            def getresponse(self): return r
            def close(self): pass
        return Connection()

    def setUp(self):
        self.requests = []
        self.body = {'key': 'a'*64, 'destination': GROUP, 'component': {'id': 'a'*64, 'kind': 'text', 'content': 'Hola'}}

    def test_unknown_get_ack_and_absent_same_body(self):
        responses = iter([self.connection(202, {'state': 'unknown', 'messageId': 'id'}), self.connection(404, {'state': 'absent'}), self.connection(200, {'state': 'acknowledged', 'messageId': 'id'})])
        send(self.body, connect=lambda: next(responses), sleep=lambda _: None)
        self.assertEqual(self.requests[1][:2], ('GET', '/family/delivery/'+'a'*64))
        self.assertEqual(self.requests[0], self.requests[2])

    def test_receipt_mismatch_and_network_failure_unknown(self):
        responses = iter([self.connection(202, {'state': 'unknown', 'messageId': 'id'}),
                          self.connection(200, {'state': 'acknowledged', 'messageId': 'different'})])
        with self.assertRaises(TimeoutError):
            send(self.body, connect=lambda: next(responses), sleep=lambda _: None)
        with self.assertRaises(ConnectionRefusedError):
            send(self.body, connect=lambda: (_ for _ in ()).throw(ConnectionRefusedError()))

    def test_definitive_and_conservative_failures(self):
        for status, result in [(503, {'state': 'definitive_failure'}), (400, {'state': 'definitive_failure', 'preReservation': True, 'reason': 'invalid_payload'}), (413, {'state': 'definitive_failure', 'preReservation': True, 'reason': 'invalid_body'})]:
            with self.assertRaises(Unavailable): send(self.body, connect=lambda: self.connection(status, result))
            responses = iter([self.connection(202, {'state': 'unknown', 'messageId': 'id'}), self.connection(404, {'state': 'absent'}), self.connection(status, result)])
            with self.assertRaises(TimeoutError): send(self.body, connect=lambda: next(responses), sleep=lambda _: None)
        for status, result in [(503, {'state': 'disabled'}), (409, {'state': 'unknown'}), (400, {'state': 'definitive_failure'})]:
            with self.assertRaises(TimeoutError): send(self.body, connect=lambda: self.connection(status, result))
