"""Synthetic event evidence only; never reads production locations."""
import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest
from google_notes import update_notes, fingerprint
from notes_runner import cycle, identity
from notes_state import State
from delivery import GROUP

T = 1800000000
RULE = dict(version=1, revision=1, name='Synthetic', address='Synthetic',
            mapsUrl='https://www.google.com/maps', latitude=0, longitude=0,
            radius=150, nearby=False, delivery={'destination': GROUP, 'message': 'Hola'})
TASK = dict(owner='Dani', id='synthetic-task', listId='synthetic-list', done=False,
            completed=None, notes=update_notes('', RULE))

def row(at, outside=False, accuracy=19, **extra):
    return dict(lat=.004 if outside else 0, lon=0, h_acc=accuracy,
                ts=at, received_at=at, **extra)

def response(rows, **extra):
    return dict(ok=True, person='dan', tz='Europe/Madrid', count=len(rows), locations=rows, **extra)

class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name)/'state.json'
        self.path.parent.chmod(0o700)
        with State(self.path, initialize=True): pass
        self.task = copy.deepcopy(TASK)
        self.sent = []
        self.reads = []
        # Existing post-authorization outside baseline, ambiguous lastfix.
        with State(self.path) as s:
            s.data['items'][identity(TASK)] = dict(listId=TASK['listId'], id=TASK['id'],
                fingerprint=fingerprint(RULE), phase='outside', lastfix=T+260,
                outside_at=T, delivery='idle', attempts=0, episode=0)
            s.save()

    def tearDown(self): self.tmp.cleanup()

    def tick(self, rows, now=T+800, result=None, sender=None, current=None):
        def history(start, end):
            self.reads.append((start, end))
            return response([r for r in rows if not isinstance(r, dict) or 'ts' not in r or r['ts'] >= start]) if result is None else result
        with State(self.path) as s:
            return cycle(s, [self.task], lambda: dict(ok=True, person='dan', location=row(now, accuracy=1414)),
                lambda _: self.task if current is None else current, sender or (lambda body: self.sent.append(body) or 'acknowledged'),
                now, history=history)

    def item(self): return next(iter(json.loads(self.path.read_text())['items'].values()))

    def recovery_setup(self, updated=T, floor=T+2000, checked=False):
        self.setUp_reset(anchor=0, lastfix=T+2000, phase='inside')
        self.task['updated'] = (datetime.fromtimestamp(updated, timezone.utc).isoformat()
                                if isinstance(updated, (int, float)) else updated)
        with State(self.path) as state:
            item = state.data['items'][identity(TASK)]
            if floor is not None:
                item['history_after'] = floor
            if checked:
                item['history_checked'] = T+2000
            state.save()

    def test_canonical_update_recovers_cleared_anchor_once(self):
        for floor in (None, T+2000):
            with self.subTest(floor=floor):
                self.recovery_setup(floor=floor)
                rows = [row(T+120, True), row(T+600), row(T+2100, accuracy=1414)]
                self.tick(rows, T+2200)
                self.assertEqual(self.reads[0][0], T)
                self.assertEqual(self.item()['history_after'], T)
                self.assertEqual([body['component']['content'] for body in self.sent], ['Hola'])
                self.tick(rows, T+2300)
                self.assertEqual(len(self.reads), 1)
                self.assertEqual(len(self.sent), 1)

    def test_final_get_revalidates_initial_recovery_update(self):
        for updated in (T+700, None, 'bad', '2026-01-01T00:00:00', T+2300):
            with self.subTest(updated=updated):
                self.recovery_setup()
                current = copy.deepcopy(self.task)
                current['title'] = 'Edited title'
                current['updated'] = (datetime.fromtimestamp(updated, timezone.utc).isoformat()
                                      if isinstance(updated, (int, float)) else updated)
                self.tick([row(T+120, True), row(T+600)], T+2200, current=current)
                self.assertFalse(self.sent)
                self.assertNotIn('dispatch', self.item())
                self.assertEqual(self.item()['attempts'], 0)
        self.recovery_setup()
        current = copy.deepcopy(self.task)
        current['notes'] = update_notes(current['notes'], {**RULE, 'revision': 2})
        self.tick([row(T+120, True), row(T+600)], T+2200, current=current)
        self.assertFalse(self.sent)

    def test_changed_rule_ignores_old_checked_history_at_read_start(self):
        self.recovery_setup(updated=T+60, checked=True)
        self.task['notes'] = update_notes(self.task['notes'], {**RULE, 'revision': 2})
        self.tick([row(T+120, True), row(T+600)], T+2200)
        self.assertEqual(self.reads[0][0], T+60)
        self.assertEqual(self.item()['history_after'], T+60)
        self.assertEqual(len(self.sent), 1)

    def test_recovery_get_crash_keeps_claim_provisional(self):
        self.recovery_setup()
        before = self.item()
        rows = [row(T+120, True), row(T+600)]
        with State(self.path) as state:
            with self.assertRaises(RuntimeError):
                cycle(state, [self.task], lambda: None,
                      lambda _: (_ for _ in ()).throw(RuntimeError('synthetic GET failure')),
                      lambda _: self.fail('send'), T+2200,
                      history=lambda *_: response(rows))
        self.assertEqual(self.item(), before)
        self.task['updated'] = datetime.fromtimestamp(T+700, timezone.utc).isoformat()
        self.tick(rows, T+2300)
        self.assertFalse(self.sent)

    def test_frozen_recovery_claim_keeps_body_key_despite_update_change(self):
        self.recovery_setup()
        rows = [row(T+120, True), row(T+600)]
        self.tick(rows, T+2200, sender=lambda body: self.sent.append(body) or 'unknown')
        frozen = copy.deepcopy(self.sent[0])
        current = copy.deepcopy(self.task)
        current['updated'] = 'bad'
        self.tick(rows, T+2300, current=current)
        self.assertEqual(self.sent, [frozen, frozen])
        self.assertEqual(len(self.reads), 1)
        self.assertEqual(self.item()['delivery'], 'sent')

    def test_recovery_rejects_untrusted_update_and_preupdate_records(self):
        for updated in (None, '', 'bad', '2099-01-01T00:00:00Z',
                        '2026-01-01T00:00:00', 'NaN', 0, T+2300, T+700):
            with self.subTest(updated=updated):
                self.recovery_setup(updated=updated)
                self.tick([row(T+120, True), row(T+600)], T+2200)
                self.assertFalse(self.sent)
        self.recovery_setup()
        self.task.pop('updated')
        self.task['sourceKey'] = datetime.fromtimestamp(T, timezone.utc).isoformat()
        self.tick([row(T+120, True), row(T+600)], T+2200)
        self.assertFalse(self.sent)

    def test_empty_read_migration_can_recover_before_first_checked_history(self):
        self.recovery_setup(updated=None, floor=None)
        self.tick([], T+2000)
        self.assertNotIn('history_checked', self.item())
        self.assertEqual(self.item()['history_after'], T+2000)
        self.task['updated'] = datetime.fromtimestamp(T, timezone.utc).isoformat()
        self.tick([row(T+120, True), row(T+600)], T+2200)
        self.assertEqual(len(self.sent), 1)

    def test_checked_history_does_not_lower_floor(self):
        self.recovery_setup(checked=True)
        self.tick([row(T+120, True), row(T+600)], T+2200)
        self.assertEqual(self.reads[0][0], T+2000)
        self.assertEqual(self.item()['history_after'], T+2000)
        self.assertFalse(self.sent)

    def test_canonical_update_new_rule_bound_and_inside_only(self):
        self.recovery_setup(updated=T+60)
        self.tick([row(T+120, True), row(T+600)], T+2200)
        self.assertEqual(len(self.sent), 1)
        self.recovery_setup()
        self.tick([row(T+600)], T+2200)
        self.assertFalse(self.sent)
        self.recovery_setup(updated=T+700)
        self.task['notes'] = update_notes(self.task['notes'], {**RULE, 'revision': 2})
        self.tick([row(T+120, True), row(T+600)], T+2200)
        self.assertEqual(self.reads[0][0], T+700)
        self.assertFalse(self.sent)
        self.recovery_setup(updated=T-10000)
        self.tick([row(T-9900, True), row(T-9500)], T+2200)
        self.assertEqual(self.reads[0][0], T+2200-7200)
        self.assertFalse(self.sent)
        self.recovery_setup()
        with State(self.path) as state:
            state.data['items'].clear()
            state.save()
        self.tick([row(T+120, True), row(T+600)], T+2200)
        self.assertEqual(len(self.sent), 1)

    def test_hidden_arrival_before_lastfix_sends_once(self):
        rows = [row(T, True), row(T+240), row(T+260, accuracy=26), row(T+480, accuracy=1414)]
        rows[2]['lat'] = .0012
        self.tick(rows)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.sent[0]['component']['content'], 'Hola')
        self.tick(rows)
        self.assertEqual(len(self.reads), 1)
        self.assertEqual(len(self.sent), 1)

    def test_observation_gap_and_bounded_replay(self):
        for now, inside, expected in [(T+7000, T+240, 1), (T+7201, T+240, 0),
                                      (T+1200, T+901, 0)]:
            with self.subTest(now=now, inside=inside):
                self.setUp_reset()
                rows = [row(T, True), row(inside)] if now-T <= 7200 else [row(inside)]
                self.tick(rows, now)
                self.assertEqual(len(self.sent), expected)

    def setUp_reset(self, anchor=T, lastfix=T+260, phase='outside'):
        self.sent.clear(); self.reads.clear()
        with State(self.path) as s:
            s.data['items'] = {identity(TASK): dict(listId=TASK['listId'], id=TASK['id'],
                fingerprint=fingerprint(RULE), phase=phase, lastfix=lastfix,
                outside_at=anchor, delivery='idle', attempts=0, episode=0)}
            s.save()

    def test_invalid_incomplete_and_future_fail_without_partial_claim(self):
        good = [row(T, True), row(T+240)]
        bad = [None, {}, response(good, truncated=True),
               response(good, has_more=True), {**response(good), 'count': 1},
               {**response(good), 'count': True}, response(good*2500),
               {**response(good), 'person': 'wife'}, {**response(good), 'ok': False},
               {**response(good), 'tz': 'UTC'},
               response(good+[row(T+801)]), response(good+[{'ts': T+400}]),
               response(good+[row(T+400, accuracy=float('nan'))]),
               response(good+[dict(row(T+400), received_at=T+399)])]
        for value in bad:
            with self.subTest(value_type=type(value).__name__):
                self.setUp_reset()
                # None is a malformed broker value, not tick's optional default.
                before = self.path.read_bytes()
                with self.assertRaises(RuntimeError):
                    if value is None:
                        with State(self.path) as s:
                            cycle(s, [self.task], lambda: None, lambda _: self.task,
                                  lambda body: self.sent.append(body), T+800, history=lambda *_: None)
                    else:
                        self.tick([], result=value)
                self.assertEqual(self.path.read_bytes(), before)
                self.assertFalse(self.sent)
                self.assertEqual(self.item()['delivery'], 'idle')

    def test_complete_201_rows_recover_without_serializing_history(self):
        rows = [row(T, True)] + [row(T+i) for i in range(1, 201)]
        self.tick(rows)
        self.assertEqual(len(self.sent), 1)
        text = self.path.read_text()
        for forbidden in ('lat', 'lon', 'h_acc', 'received_at', 'locations'):
            self.assertNotIn(forbidden, text)

    def test_out_of_order_same_second_and_newer_exit_preserved(self):
        rows = [row(T+600, True), row(T+240, accuracy=1414),
                row(T+240), row(T, True), row(T+240)]
        rows[2]['received_at'] = T+700
        self.tick(rows)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual((self.item()['phase'], self.item()['outside_at'], self.item()['lastfix']),
                         ('outside', T+600, T+600))

    def test_newer_exit_absent_from_response_is_preserved(self):
        self.setUp_reset(anchor=T+600, lastfix=T+600)
        with State(self.path) as s:
            s.data['items'][identity(TASK)]['history_after'] = T
            s.save()
        self.tick([row(T, True), row(T+240)])
        self.assertEqual(len(self.sent), 1)
        self.assertEqual((self.item()['phase'], self.item()['outside_at']), ('outside', T+600))

    def test_actual_phone_sample_kinds(self):
        for kind in ('significant', 'trip', 'fence'):
            self.setUp_reset()
            self.tick([row(T, True, kind=kind), row(T+240, kind=kind)])
            self.assertEqual(len(self.sent), 1)

    def test_departure_visit_not_inside_evidence(self):
        self.tick([row(T, True), row(T+240, kind='visit_departure')])
        self.assertFalse(self.sent)
        self.tick([row(T, True), row(T+240, kind='visit_arrival')])
        self.assertFalse(self.sent)

    def test_no_unanchored_or_prearm_arrival(self):
        for rows in ([row(T+240)], [row(T, True), row(T+240)]):
            self.setUp_reset(anchor=0, lastfix=0, phase=None)
            self.tick(rows)
            self.tick(rows, T+900)
            self.assertFalse(self.sent)
        self.tick([row(T+810, True), row(T+850)], T+900)
        self.assertEqual(len(self.sent), 1)

    def test_revision_resets_cursor_and_blocks_prechange_movement(self):
        self.tick([row(T, True), row(T+260, accuracy=1414)])
        self.task['notes'] = update_notes(self.task['notes'], {**RULE, 'revision': 2})
        self.tick([row(T, True), row(T+240)])
        self.assertFalse(self.sent)
        self.assertEqual(self.item()['history_after'], T+800)
        self.tick([row(T+810, True), row(T+850)], T+900)
        self.assertEqual(len(self.sent), 1)
        self.task['notes'] = update_notes(self.task['notes'], {**RULE, 'revision': 3})
        self.tick([row(T+910, True), row(T+950)], T+1000)
        self.assertEqual(len(self.sent), 1)

    def test_late_arrival_multiple_polls_and_privacy(self):
        ambiguous = dict(row(T+260, accuracy=26), lat=.0012)
        self.tick([row(T, True), ambiguous])
        self.assertFalse(self.sent)
        late = dict(row(T+240), received_at=T+850)
        self.tick([ambiguous, late, row(T, True), row(T+880, accuracy=1414)], T+900)
        self.assertEqual(len(self.sent), 1)
        self.tick([], T+1000)
        self.assertEqual(len(self.reads), 2)
        text = self.path.read_text()
        for forbidden in ('lat', 'lon', 'h_acc', 'received_at', 'locations', 'Synthetic'):
            self.assertNotIn(forbidden, text)

    def test_broker_error_and_failed_read_do_not_advance_baseline(self):
        before = self.item()
        with State(self.path) as s:
            with self.assertRaises(RuntimeError):
                cycle(s, [self.task], lambda: None, lambda _: self.task,
                      lambda _: self.fail('send'), T+800,
                      history=lambda *_: (_ for _ in ()).throw(RuntimeError('broker')))
        self.assertEqual(self.item(), before)
        self.tick([row(T, True), row(T+240)])
        self.assertEqual(len(self.sent), 1)

    def test_claim_crash_retry_frozen_and_no_history_reread(self):
        def crash(body):
            self.sent.append(body)
            self.assertEqual(self.item()['delivery'], 'unknown')
            self.assertEqual(self.item()['dispatch']['body'], body)
            raise KeyboardInterrupt
        with self.assertRaises(KeyboardInterrupt):
            self.tick([row(T, True), row(T+240)], sender=crash)
        old = copy.deepcopy(self.sent[0])
        # Same rule: only title changes. Durable body/key survive code/restart.
        self.task['title'] = 'Changed'
        self.tick([], T+1000)
        self.assertEqual(self.sent, [old, old])
        self.assertEqual(len(self.reads), 1)

    def test_changed_claim_cannot_reroute(self):
        self.tick([row(T, True), row(T+240)], sender=lambda body: self.sent.append(body) or 'unknown')
        self.task['notes'] = update_notes(self.task['notes'], {**RULE, 'revision': 2,
            'delivery': {'destination': '238615548420255@lid', 'message': 'Changed'}})
        self.tick([], T+1000)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(len(self.reads), 1)
        self.assertEqual(self.item()['delivery'], 'unknown')

    def test_shared_read_across_rules(self):
        other = {**self.task, 'id': 'other'}
        with State(self.path) as s:
            s.data['items'][identity(other)] = {**s.data['items'][identity(TASK)], 'id': 'other'}
            s.save()
            calls = []
            def history(start, end):
                calls.append((start, end))
                return response([row(T, True), row(T+240)])
            cycle(s, [self.task, other], lambda: None,
                  lambda task_id: self.task if task_id == TASK['id'] else other,
                  lambda body: self.sent.append(body) or 'acknowledged', T+800, history=history)
        self.assertEqual(calls, [(T, T+800)])
        self.assertEqual(len(self.sent), 2)

    def test_private_history_claim_compatible(self):
        rule = {k: v for k, v in RULE.items() if k != 'delivery'}
        self.task['notes'] = update_notes('', rule)
        with State(self.path) as s:
            s.data['items'][identity(TASK)]['fingerprint'] = fingerprint(rule)
            s.save()
        self.tick([row(T, True), row(T+240)])
        self.assertEqual(self.sent[0]['destination'], '238615548420255@lid')
        self.assertIn('idempotency_key', self.sent[0])

    def test_runtime_cli_history_contract(self):
        from notes_runner import Runtime
        from unittest.mock import patch
        from datetime import datetime
        runtime = Runtime({})
        with patch.object(runtime, 'call', return_value=(0, json.dumps(response([row(T)])))) as call:
            self.assertEqual(runtime.history(T, T+800)['count'], 1)
        args = call.call_args.args[0]
        self.assertEqual(args[2:4], ['locations', 'dan'])
        self.assertEqual(args[args.index('--order')+1], 'asc')
        self.assertEqual(args[args.index('--limit')+1], '5000')
        self.assertEqual(args[args.index('--tz')+1], 'Europe/Madrid')
        self.assertEqual(datetime.fromisoformat(args[args.index('--from')+1]).timestamp(), T)
        self.assertEqual(datetime.fromisoformat(args[args.index('--to')+1]).timestamp(), T+800)
        with patch.object(runtime, 'call', return_value=(0, '{"ok": true}')) as call:
            runtime.evidence(T, T+800)
        evidence_args = call.call_args.args[0]
        self.assertEqual(evidence_args[evidence_args.index('--limit')+1], '200')
        with patch.object(runtime, 'call', return_value=(1, '')):
            with self.assertRaises(RuntimeError): runtime.history(T, T+800)
        with patch.object(runtime, 'call', return_value=(0, '{')):
            with self.assertRaises(RuntimeError): runtime.history(T, T+800)


    def test_duplicate_ids_and_conflicts(self):
        point = row(T+240, id='synthetic-event')
        self.tick([row(T, True), point, point])
        self.assertEqual(len(self.sent), 1)
        self.setUp_reset()
        with self.assertRaises(RuntimeError):
            self.tick([row(T, True), point, {**point, 'lat': .004}])
        self.assertFalse(self.sent)

    def test_conflicting_timestamp_with_prior_anchor_does_not_claim_or_set_baseline(self):
        for ids in ({'id': 'inside'}, {}):
            for reverse in (False, True):
                for lastfix in (T+100, T+260):
                    with self.subTest(ids=bool(ids), reverse=reverse, lastfix=lastfix):
                        self.setUp_reset(lastfix=lastfix)
                        tied = [row(T+240, **ids),
                                row(T+240, True, **({'id': 'outside'} if ids else {}))]
                        self.tick([row(T, True)] + (tied[::-1] if reverse else tied))
                        item = self.item()
                        self.assertFalse(self.sent)
                        self.assertEqual((item['delivery'], item['episode']), ('idle', 0))
                        self.assertEqual((item['phase'], item['outside_at'], item['lastfix']),
                                         ('outside', T, lastfix))
                        self.assertNotIn('dispatch', item)

    def test_uncertain_timestamp_retains_anchor_for_later_real_inside(self):
        for reverse in (False, True):
            self.setUp_reset(lastfix=T+100)
            tied = [row(T+240), row(T+240, True)]
            self.tick([row(T, True)] + (tied[::-1] if reverse else tied))
            self.assertFalse(self.sent)
            self.tick([row(T+300, kind='significant')], T+900)
            self.assertEqual(len(self.sent), 1)

    def test_precise_inside_not_masked_by_coarse_or_ambiguous_tie(self):
        for uncertain in (row(T+240, accuracy=1414),
                          dict(row(T+240, accuracy=26), lat=.0012)):
            for reverse in (False, True):
                with self.subTest(accuracy=uncertain['h_acc'], reverse=reverse):
                    self.setUp_reset(lastfix=T+100)
                    tied = [row(T+240, kind='significant'), uncertain]
                    self.tick([row(T, True)] + (tied[::-1] if reverse else tied))
                    self.assertEqual(len(self.sent), 1)
                    self.assertEqual(self.item()['lastfix'], T+240)

    def test_same_second_is_not_invented_transition(self):
        for reverse in (False, True):
            self.setUp_reset(anchor=0, lastfix=0, phase=None)
            with State(self.path) as s:
                s.data['items'][identity(TASK)]['history_after'] = T
                s.save()
            tied = [row(T+240, True), row(T+240)]
            self.tick(tied[::-1] if reverse else tied)
            self.assertFalse(self.sent)
            self.assertEqual((self.item()['phase'], self.item()['outside_at'],
                              self.item()['lastfix'], self.item()['episode']),
                             (None, 0, 0, 0))
