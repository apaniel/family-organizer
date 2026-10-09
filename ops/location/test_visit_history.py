"""Synthetic broker-contract visits through real history replay and canonical GET."""
import copy
from datetime import datetime, timezone
import json
from unittest.mock import patch
import unittest
import test_arrival_history as helpers
from test_arrival_history import T, RULE, row, response
from google_notes import update_notes
from notes_runner import Runtime


def visit(at=T+240, departure=None, **extra):
    return row(at if departure is None else departure, kind='visit_arrival' if departure is None else 'visit_departure',
               arrival=at, departure=departure, **extra)


class VisitTests(unittest.TestCase):
    setUp = helpers.HistoryTests.setUp
    tearDown = helpers.HistoryTests.tearDown
    tick = helpers.HistoryTests.tick
    item = helpers.HistoryTests.item
    recovery_setup = helpers.HistoryTests.recovery_setup
    setUp_reset = helpers.HistoryTests.setUp_reset
    def setup_visit(self, nearby=True, updated=T):
        self.recovery_setup(updated=updated, floor=None)
        rule = {**RULE, 'nearby': nearby, 'radius': 100}
        self.task['notes'] = update_notes('', rule)

    def test_verified_late_visit_runtime_get_group_callback(self):
        self.setup_visit()
        rows = [visit(at=T+240)]
        rows[0]['received_at'] = T+546.615
        rows[0]['lat'] = .00046
        mobile = row(T+247, accuracy=8.24, kind='fence')
        mobile['lat'] = .00162  # precise outside seven seconds after observed arrival
        rows.append(mobile)
        runtime = Runtime({})
        wire_rows = copy.deepcopy(rows)
        for wire_row in wire_rows:
            for field in ('ts', 'arrival', 'received_at'):
                if field in wire_row:
                    wire_row[field] = datetime.fromtimestamp(wire_row[field], timezone.utc).isoformat()
        with patch.object(runtime, 'call', return_value=(0, json.dumps(response(wire_rows)))):
            result = runtime.history(T, T+800)
        self.tick([], T+800, result=result)
        self.assertEqual([b['component']['content'] for b in self.sent], ['Hola'])
        self.tick(rows, T+900)
        self.assertEqual(len(self.sent), 1)

    def test_visit_only_both_nearby_policies_and_duplicate_orders(self):
        for nearby in (True, False):
            for rows in ([visit()], [visit(), row(T+245)], [row(T+245), visit()]):
                with self.subTest(nearby=nearby, rows=rows):
                    self.setup_visit(nearby)
                    self.tick(rows)
                    self.assertEqual(len(self.sent), 1)
                    self.tick(rows, T+900)
                    self.assertEqual(len(self.sent), 1)

    def test_visit_arrival_survives_later_departure_and_movement(self):
        for tail in ([visit(departure=T+400)], [visit(departure=T+400, accuracy=112.24)],
                     [row(T+400, True)], [dict(visit(at=T+400), lat=.004)],
                     ):
            self.setup_visit()
            self.tick([visit()] + tail)
            self.assertEqual(len(self.sent), 1)
            self.assertEqual(self.item()['phase'], 'outside')
        self.setup_visit(False)
        self.tick([visit(departure=T+400)])
        self.assertFalse(self.sent)
        self.assertEqual(self.item()['outside_at'], 0)
        self.tick([row(T+600)], T+900)
        self.assertFalse(self.sent)
        # nearby=false must not turn a departure point into exterior GPS.

    def test_invalid_visit_times_geometry_and_metadata(self):
        for changes in ({'arrival': None}, {'arrival': 'bad'}, {'arrival': T+900},
                        {'received_at': T+900}, {'departure': T+300},
                        {'h_acc': 101}, {'h_acc': float('nan')}, {'lat': float('inf')}):
            self.setup_visit()
            if any(k in changes for k in ('received_at',)) or any(k in changes and not __import__('math').isfinite(changes[k]) for k in ('h_acc', 'lat')):
                with self.assertRaises(RuntimeError):
                    self.tick([{**visit(), **changes}])
            else:
                self.tick([{**visit(), **changes}])
            self.assertFalse(self.sent)
        self.setup_visit(False)
        self.tick([visit(), {'kind': 'device_metadata'}])
        self.assertEqual(len(self.sent), 1)

    def test_visit_authorization_bound_and_final_get(self):
        for updated in (T+300, T-10000):
            self.setup_visit(False, updated)
            self.tick([visit(at=T-9000 if updated < T else T+240)])
            self.assertFalse(self.sent)
        self.setup_visit()
        current = copy.deepcopy(self.task); current['done'] = True
        self.tick([visit()], current=current)
        self.assertFalse(self.sent)
        self.setup_visit()
        current = copy.deepcopy(self.task); current['updated'] = 'bad'
        self.tick([visit()], current=current)
        self.assertFalse(self.sent)

    def test_visit_unknown_restart_frozen_body_and_revision(self):
        self.setup_visit()
        self.tick([visit()], sender=lambda b: self.sent.append(b) or 'unknown')
        frozen = copy.deepcopy(self.sent[0])
        self.task['title'] = 'Changed'
        self.tick([visit()], T+900)
        self.assertEqual(self.sent, [frozen, frozen])
        self.task['notes'] = update_notes('', {**RULE, 'revision': 3, 'nearby': True})
        self.tick([visit()], T+1000)
        self.assertEqual(len(self.sent), 2)

    def test_event_time_not_recording_or_receipt_and_delayed_between_polls(self):
        self.setup_visit()
        self.tick([row(T+200, accuracy=1000)], T+300)
        late = visit(); late.update(ts=T+500, received_at=T+600)
        self.tick([late], T+800)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.item()['lastfix'], T+240)
        self.setup_visit(False, T+300)
        self.tick([late])
        self.assertFalse(self.sent)

    def test_saved_newer_exit_and_conflicting_ids(self):
        self.setup_visit()
        self.tick([row(T+400, True)])
        self.tick([visit()], T+900)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.item()['lastfix'], T+400)
        self.setup_visit()
        with self.assertRaises(RuntimeError):
            self.tick([dict(visit(), id='same'), dict(visit(), id='same', lat=.004)])
        self.assertFalse(self.sent)

    def test_departure_does_not_imply_arrival_or_outside_at_other_place(self):
        self.setup_visit(False)
        departure = visit(departure=T+400); departure['lat'] = .004
        self.tick([departure])
        self.assertEqual(self.item()['outside_at'], 0)
        self.tick([row(T+600)], T+900)
        self.assertFalse(self.sent)

    def test_visit_provider_saturation_and_future_receipt_fail_closed(self):
        for result in (response([visit()], truncated=True),
                       dict(response([visit()]), count=2), response([visit()]*5000),
                       response([dict(visit(), received_at=T+801)])):
            self.setup_visit()
            with self.assertRaises(RuntimeError):
                self.tick([], result=result)
            self.assertFalse(self.sent)

    def test_departure_requires_true_timestamp_and_order(self):
        for changes in ({'departure': None}, {'departure': 'bad'}, {'arrival': None},
                        {'arrival': T+500}, {'departure': T+900}):
            self.setup_visit(False)
            self.tick([{**visit(departure=T+400), **changes}])
            self.assertFalse(self.sent)
            self.assertEqual(self.item()['outside_at'], 0)
        self.setup_visit(False)
        departure = visit(departure=T+400)
        departure.update(ts=T+600, received_at=T+700)
        self.tick([departure])
        self.assertEqual(self.item()['lastfix'], T+400)
        self.assertEqual(self.item()['outside_at'], 0)

    def test_seven_second_outside_and_late_omitted_exit_both_policies(self):
        for nearby in (True, False):
            for separate in (True, False):
                self.setup_visit(nearby)
                outside = row(T+247, accuracy=8.24, kind='fence'); outside['lat'] = .00162
                arrival = visit(accuracy=20.096); arrival.update(lat=.00046, received_at=T+546.615)
                if separate:
                    self.tick([outside], T+300)
                self.tick([arrival] if separate else [arrival, outside], T+800)
                self.assertEqual(len(self.sent), 1)
                self.assertEqual((self.item()['phase'], self.item()['lastfix']), ('outside', T+247))
                self.tick([arrival], T+900)
                self.assertEqual(len(self.sent), 1)

    def test_tied_outside_stays_uncertain_both_policies(self):
        for nearby in (True, False):
            self.setup_visit(nearby)
            self.tick([visit(), row(T+240, True)])
            self.assertFalse(self.sent)

    def test_actual_run_cli_provider_failure_preserves_bytes_and_recovers(self):
        import os
        from pathlib import Path
        import subprocess
        import sys
        from notes_runner import run
        root = Path(__file__).resolve().parent
        fixture = self.path.parent/'provider.json'
        tasks = self.path.parent/'tasks.py'
        location = self.path.parent/'location.py'
        tasks.write_text('import json,sys\nfrom pathlib import Path\nf=json.loads(Path(sys.argv[0]).with_name("provider.json").read_text())\np=json.load(sys.stdin)\nprint(json.dumps({"tasks":[f["task"]]} if sys.argv[1]=="list" else {"task":f["task"]}))\n')
        location.write_text('import json,sys\nfrom pathlib import Path\nf=json.loads(Path(sys.argv[0]).with_name("provider.json").read_text())\nassert sys.argv[1]=="locations"\nprint(json.dumps(f["history"]))\n')
        config = dict(enabled=True, interval_seconds=300, state=str(self.path),
                      sender=str(root/'private_sender.py'), tasks_client=str(tasks), location_client=str(location))
        config_path = self.path.parent/'config.json'; config_path.write_text(json.dumps(config))
        command = [sys.executable, '-B', '-c',
                   'import time,runpy,sys;time.time=lambda:1800000800;sys.argv=sys.argv[1:];sys.path.insert(0,str(__import__("pathlib").Path(sys.argv[0]).parent));runpy.run_path(sys.argv[0],run_name="__main__")',
                   str(root/'notes_runner.py'), '--config', str(config_path), '--quiet']
        good = response([visit()])
        failures = [dict(good, ok=False), dict(good, truncated=True), dict(good, has_more=True),
                    dict(good, count=2), response([visit()]*5000), dict(good, locations='invalid'),
                    response([dict(visit(), lat=True)])]
        for bad in failures:
            with self.subTest(shape={k:v for k,v in bad.items() if k!='locations'}):
                self.setup_visit()
                before = self.path.read_bytes()
                fixture.write_text(json.dumps(dict(task=self.task, history=bad)))
                with patch.object(Runtime, 'send', side_effect=AssertionError('No partial claim')):
                    with self.assertRaises(RuntimeError):
                        run(config, clock=lambda:T+800)
                self.assertEqual(self.path.read_bytes(), before)
                child = subprocess.run(command, capture_output=True, text=True, timeout=10,
                                       env={**os.environ, 'PYTHONDONTWRITEBYTECODE':'1'})
                self.assertEqual(child.returncode, 1, child.stdout)
                self.assertEqual(child.stdout, '')
                self.assertEqual(child.stderr, 'Location notes cycle stopped; no success confirmed.\n')
                self.assertEqual(self.path.read_bytes(), before)
                fixture.write_text(json.dumps(dict(task=self.task, history=good)))
                with patch.object(Runtime, 'send', side_effect=lambda b:self.sent.append(b) or 'acknowledged'):
                    self.assertEqual(run(config, clock=lambda:T+800)['sent'], 1)
                self.assertEqual([b['component']['content'] for b in self.sent], ['Hola'])
        self.setup_visit()
        fixture.write_text(json.dumps(dict(task=self.task, history=response([]))))
        child = subprocess.run(command, capture_output=True, text=True, timeout=10)
        self.assertEqual((child.returncode, child.stdout, child.stderr), (0, '', ''))
        self.assertEqual(self.item()['delivery'], 'idle')
