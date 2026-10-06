import copy
from datetime import datetime, timezone
import unittest
from unittest.mock import Mock
import test_notes as existing
from test_notes import RULE, NOW, fix
from google_notes import update_notes, parse, due_stamp
from notes_runner import cycle, continuing_presence, delivery_body
from notes_state import State
from author_notes import migrate_legacy

class UnifiedTests(unittest.TestCase):
    setUp = existing.NotesTests.setUp
    tearDown = existing.NotesTests.tearDown
    tick = existing.NotesTests.tick
    sender = existing.NotesTests.sender
    read = existing.NotesTests.read
    item = existing.NotesTests.item
    def timed(self, due=NOW):
        rule = copy.deepcopy(RULE)
        rule.pop('nearby'); rule['version'] = 2
        rule['trigger'] = {'type': 'presence_at', 'dueAt': datetime.fromtimestamp(due, timezone.utc).isoformat()}
        self.task['notes'] = update_notes('Unrelated\n#hermes source=kept\n', rule)
        return rule

    def test_strict_dates(self):
        for value in ('2026-02-30T12:00:00Z', '2026-10-06T12:00:00', '2026-10-06T24:00:00Z', '2026-10-06T12:00:00+01:99'):
            with self.assertRaises(ValueError): due_stamp(value)
        self.assertEqual(due_stamp('2026-10-07T00:00:00+02:00'), due_stamp('2026-10-06T22:00:00Z'))

    def test_future_no_health_then_one_evaluation(self):
        self.timed(NOW+300)
        health = Mock(return_value=fix(at=NOW+300))
        with State(self.path) as state:
            cycle(state, [self.task], health, lambda _: self.task, self.sender, NOW)
        health.assert_not_called()
        with State(self.path) as state:
            cycle(state, [self.task], health, lambda _: self.task, self.sender, NOW+300)
        self.assertEqual(self.item()['evaluated_at'], NOW+300)
        self.assertEqual(self.item()['outcome'], 'inside')
        with State(self.path) as state:
            cycle(state, [self.task], health, lambda _: self.task, self.sender, NOW+600)
        self.assertEqual(health.call_count, 1)
        self.assertEqual(len(self.receipts), 1)

    def test_outside_and_stale_notice_once(self):
        for sample, expected in ((fix(outside=True), 'outside'), (fix(at=NOW-600), 'stale')):
            with self.subTest(expected=expected):
                self.timed()
                with State(self.path) as state:
                    state.data['items'] = {}; state.save()
                    cycle(state, [self.task], lambda: sample, lambda _: self.task, self.sender, NOW)
                self.assertEqual(self.item()['outcome'], expected)

    def test_invalid_notice_deduped(self):
        self.task['notes'] = '[hermes-location:v2]\nbad\n[/hermes-location:v2]'
        self.tick(fix()); self.tick(fix())
        self.assertEqual(len(self.receipts), 1)

    def test_stationary_bounded_evidence(self):
        sample = fix(at=NOW-1800); sample['location'].update(motion='stationary')
        rows = []
        for age in (3600, 2700, 1800):
            row = fix(at=NOW-age)['location']; row.update(motion='stationary'); rows.append(row)
        persons = {'ok': True, 'persons': [{'person': 'dan', 'last_upload_at': NOW-10, 'last_location_ts': NOW-1800, 'devices': [{'label': 'dan-iphone', 'revoked': False, 'last_seen': NOW-10}]}]}
        history = {'ok': True, 'person': 'dan', 'locations': rows, 'count': 3}
        evidence = lambda *_: (persons, history)
        self.assertEqual(continuing_presence(sample, RULE, NOW, evidence), 'inferred_inside')
        persons['persons'][0]['devices'][0]['last_seen'] = NOW-1000
        self.assertEqual(continuing_presence(sample, RULE, NOW, evidence), 'stale')
        persons['persons'][0]['devices'][0]['last_seen'] = NOW-10
        history['truncated'] = True
        self.assertEqual(continuing_presence(sample, RULE, NOW, evidence), 'uncertain')
        history['truncated'] = False
        rows.append({**fix(outside=True)['location'], 'motion': 'walking'}); history['count'] = 4
        self.assertEqual(continuing_presence(sample, RULE, NOW, evidence), 'uncertain')

    def broker_fixture(self):
        # Private offline fixture with the actual broker keys and ISO timestamp format.
        def iso(value):
            return datetime.fromtimestamp(value, timezone.utc).isoformat().replace('+00:00', 'Z')
        rows = []
        for index, age in enumerate((6300, 4500, 1800)):
            row = fix(at=NOW-age)['location']
            row.update(id=f'event-{index}', ts=iso(NOW-age), received_at=iso(NOW-age+1),
                       motion='stationary', kind='significant')
            rows.append(row)
        sample = {'ok': True, 'person': 'dan', 'location': copy.deepcopy(rows[-1])}
        persons = {'ok': True, 'now': iso(NOW-100000), 'persons': [{
            'person': 'dan', 'last_location_ts': rows[-1]['ts'], 'last_upload_at': iso(NOW-10),
            'devices': [{'label': 'dan-iphone', 'created_at': '2026-10-03T12:43:54.161Z',
                         'last_seen': iso(NOW-10), 'revoked': False, 'model': 'iPhone17,2',
                         'os': '26.6.1', 'app_version': '2026.9.8 (1)', 'tz': 'Europe/Madrid'}]}]}
        history = {'ok': True, 'person': 'dan', 'tz': 'Europe/Madrid', 'count': 3, 'locations': rows}
        return sample, persons, history

    def test_actual_broker_shape_and_local_clock(self):
        sample, persons, history = self.broker_fixture()
        evidence = Mock(return_value=(persons, history))
        self.assertEqual(continuing_presence(sample, RULE, NOW, evidence), 'inferred_inside')
        evidence.assert_called_once_with(NOW-1800-7200, NOW)
        # At 17 minutes without contact, even this complete stationary baseline is stale.
        persons['persons'][0]['last_upload_at'] = NOW-1020
        persons['persons'][0]['devices'][0]['last_seen'] = NOW-1020
        self.assertEqual(continuing_presence(sample, RULE, NOW, evidence), 'stale')

    def test_actual_broker_person_device_and_consistency_validation(self):
        for mutate in (
            lambda p, h: p.update(ok=False),
            lambda p, h: p['persons'][0].update(person='someone-else'),
            lambda p, h: p['persons'].append(copy.deepcopy(p['persons'][0])),
            lambda p, h: p['persons'][0].update(last_location_ts=NOW-1900),
            lambda p, h: p['persons'][0]['devices'].append({'label': 'second', 'revoked': False, 'last_seen': NOW-10}),
            lambda p, h: p['persons'][0]['devices'][0].update(revoked=True),
            lambda p, h: h.update(person='someone-else'),
        ):
            sample, persons, history = self.broker_fixture()
            mutate(persons, history)
            self.assertEqual(continuing_presence(sample, RULE, NOW, lambda *_: (persons, history)), 'uncertain')
        sample, persons, history = self.broker_fixture()
        persons['persons'][0]['devices'].append({'label': 'old', 'revoked': True})
        self.assertEqual(continuing_presence(sample, RULE, NOW, lambda *_: (persons, history)), 'inferred_inside')
        persons['persons'][0]['last_upload_at'] = NOW-1800
        self.assertEqual(continuing_presence(sample, RULE, NOW, lambda *_: (persons, history)), 'stale')

    def test_actual_broker_history_completeness(self):
        for count in (191, 199, 200, 201):
            sample, persons, history = self.broker_fixture()
            history['locations'] += [copy.deepcopy(history['locations'][0]) for _ in range(count-3)]
            history['count'] = count
            self.assertEqual(continuing_presence(sample, RULE, NOW, lambda *_: (persons, history)),
                             'inferred_inside' if count < 200 else 'uncertain')
        for change in ({'count': 4}, {'truncated': True}, {'has_more': True}, {'ok': False}):
            sample, persons, history = self.broker_fixture()
            history.update(change)
            self.assertEqual(continuing_presence(sample, RULE, NOW, lambda *_: (persons, history)), 'uncertain')

    def test_actual_broker_burst_and_event_deduplication(self):
        for ages, expected in (((1800, 1800, 1800), 'stale'), ((3600, 1801, 1800), 'stale'),
                               ((3600, 2100, 1800), 'inferred_inside')):
            sample, persons, history = self.broker_fixture()
            history['locations'] = [{**sample['location'], 'id': f'row-{i}', 'ts': NOW-age,
                                     'received_at': NOW-age+1} for i, age in enumerate(ages)]
            self.assertEqual(continuing_presence(sample, RULE, NOW, lambda *_: (persons, history)), expected)
        sample, persons, history = self.broker_fixture()
        history['locations'][0]['id'] = history['locations'][-1]['id']
        self.assertEqual(continuing_presence(sample, RULE, NOW, lambda *_: (persons, history)), 'uncertain')

    def test_stationary_contact_rechecked_after_broker_read(self):
        self.timed()
        sample, persons, history = self.broker_fixture()
        evidence = Mock(return_value=(persons, history))
        clock = Mock(side_effect=(NOW, NOW, NOW+901))
        with State(self.path) as state:
            cycle(state, [self.task], lambda: sample, lambda _: self.task, self.sender,
                  clock=clock, evidence=evidence)
        self.assertEqual(self.item()['outcome'], 'stale')
        self.assertEqual(self.item()['evaluated_at'], NOW+901)
        self.assertEqual(evidence.call_count, 1)

    def test_broker_history_request_limit(self):
        import json
        from notes_runner import Runtime
        _, persons, history = self.broker_fixture()
        runtime = Runtime({})
        runtime.call = Mock(side_effect=((0, json.dumps(persons)), (0, json.dumps(history))))
        self.assertEqual(runtime.evidence(NOW-9000, NOW), (persons, history))
        request = runtime.call.call_args_list[-1].args[0]
        self.assertEqual(request[request.index('--limit')+1], '200')
        self.assertEqual(request[request.index('--order')+1], 'asc')

    def test_migration_preserves_terminal_and_unknown_body(self):
        rule = self.timed()
        for status in ('sent', 'skipped', 'cancelled', 'unknown'):
            body = {'destination': '238615548420255@lid', 'message': 'original', 'idempotency_key': 'presence:v1:original'}
            with State(self.path) as state:
                state.data['items'] = {}; state.save()
                migrate_legacy(state, self.task, rule, {'version': 1, 'claim': {'body': body, 'status': status}}, NOW)
                item = next(iter(state.data['items'].values()))
                self.assertEqual(delivery_body(item), body)
                self.assertEqual(item['delivery'], status if status in ('sent', 'unknown') else 'stopped')
                with self.assertRaises(ValueError):
                    migrate_legacy(state, self.task, rule, {'version': 1, 'claim': {'body': body, 'status': status}}, NOW)

    def test_canonical_change_done_delete_before_send(self):
        for change in ({'done': True}, {'deleted': True}, {'notes': 'removed'}):
            self.timed()
            with State(self.path) as state:
                state.data['items'] = {}; state.save()
                cycle(state, [self.task], lambda: fix(), lambda _: {**self.task, **change}, self.sender, NOW)
            self.assertEqual(self.item()['delivery'], 'stopped')
        with State(self.path) as state:
            state.data['items'] = {}; state.save()
            cycle(state, [self.task], lambda: fix(), lambda _: None, self.sender, NOW)
        self.assertEqual(self.item()['delivery'], 'stopped')
        self.assertFalse(self.receipts)

    def test_due_late_unknown_replay_does_not_evaluate_again(self):
        self.timed(NOW-300)
        bodies = []
        def send(body):
            bodies.append(body)
            return 'unknown' if len(bodies) == 1 else 'acknowledged'
        with State(self.path) as state:
            cycle(state, [self.task], lambda: fix(), lambda _: self.task, send, NOW)
        self.task['title'] = 'changed'
        with State(self.path) as state:
            cycle(state, [self.task], lambda: self.fail('second evaluation'), lambda _: self.task, send, NOW+600)
        self.assertEqual(bodies[0], bodies[1])
        self.assertEqual(self.item()['evaluated_at'], NOW)
        self.assertNotIn('latitude', self.path.read_text())
        self.assertNotIn('locations', self.path.read_text())

    def test_v2_metadata_and_upgrade(self):
        rule = self.timed()
        notes = self.task['notes']
        self.assertTrue(notes.endswith('#hermes source=kept\n'))
        self.assertEqual(parse(notes), rule)
        new = {**rule, 'revision': 2, 'trigger': {'type': 'arrival', 'nearby': False}}
        self.assertEqual(parse(update_notes(notes, new)), new)
        self.assertTrue(update_notes(notes, new).endswith('#hermes source=kept\n'))

    def test_provider_failure_not_silenced(self):
        sample = fix(at=NOW-1800); sample['location'].update(motion='stationary')
        def failed(*_): raise RuntimeError('broker failed')
        with self.assertRaises(RuntimeError): continuing_presence(sample, RULE, NOW, failed)

    def test_offline_migration_cli(self):
        import json, subprocess, sys
        from pathlib import Path
        rule = self.timed()
        task = self.directory/'task.json'; task.write_text(json.dumps(self.task))
        legacy = self.directory/'legacy.json'
        legacy.write_text(json.dumps({'version': 1, 'claim': {'status': 'skipped', 'body': {'destination': '238615548420255@lid', 'message': 'immutable', 'idempotency_key': 'presence:v1:old'}}}))
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('author_notes.py')), '--migrate-legacy', '--canonical-task', str(task), '--legacy-state', str(legacy), '--state', str(self.path), '--evaluated-at', rule['trigger']['dueAt']], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.item()['delivery'], 'stopped')
