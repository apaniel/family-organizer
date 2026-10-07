"""Actual author/runner/sender CLI, canonical broker mocks, synthetic group journal."""
import copy
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from test_notes import TASK, RULE, ROOT
from test_notes_cli import SITE
from google_notes import update_notes, parse
from notes_state import State
from notes_runner import identity
from google_notes import fingerprint

GROUP = '120363411293061762@g.us'
SITE_GROUP = SITE.replace("assert method=='POST' and url=='/family/private-notice'", "assert (method=='POST' and url=='/family/delivery') or (method=='GET' and url.startswith('/family/delivery/'))")


class GroupCliTests(unittest.TestCase):
    def test_actual_author_cli_opt_in_reject_claim_and_preserve_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary); directory.chmod(0o700)
            (directory/'sitecustomize.py').write_text(SITE)
            fixture = directory/'fixture.json'; calls = directory/'calls.jsonl'
            task = copy.deepcopy(TASK)
            narrative = 'Este aviso se entrega solo en privado.'
            task['notes'] += '\n' + narrative + '\n#hermes root=preserved'
            fixture.write_text(json.dumps({'tasks': [task]}))
            state_path = directory/'state.json'
            with State(state_path, initialize=True): pass
            env = {**os.environ, 'PYTHONPATH': str(directory), 'NOTES_FIXTURE': str(fixture), 'NOTES_CALLS': str(calls), 'NOTES_TEST_PORT': '0'}
            bootstrap = "import sys;sys.path.insert(0,sys.argv[1]);import notes_runner;notes_runner.TASKS=sys.argv[2];import runpy;sys.argv=[sys.argv[3]]+sys.argv[4:];runpy.run_path(sys.argv[0],run_name='__main__')"
            client = Path('/opt/hermes-tasks/client.py')
            if not client.is_file(): client = ROOT/'test-fixtures/tasks_client.approved.py'
            command = [sys.executable, '-c', bootstrap, str(ROOT), str(client), str(ROOT/'author_notes.py'),
                       '--id', TASK['id'], '--list-id', TASK['listId'], '--source-key', TASK['sourceKey'],
                       '--name', RULE['name'], '--address', RULE['address'], '--maps-url', RULE['mapsUrl'],
                       '--latitude', str(RULE['latitude']), '--longitude', str(RULE['longitude']),
                       '--radius', '150', '--revision', '2', '--nearby', 'false', '--state', str(state_path),
                       '--delivery-destination', GROUP, '--delivery-message', 'Hola',
                       '--replace-trailing-private-narrative', narrative]
            result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            current = json.loads(fixture.read_text())['tasks'][0]
            self.assertEqual(parse(current['notes'])['delivery'], {'destination': GROUP, 'message': 'Hola'})
            self.assertTrue(current['notes'].endswith('#hermes root=preserved'))
            self.assertEqual(current['sourceKey'], task['sourceKey'])
            self.assertEqual([json.loads(line)['action'] for line in calls.read_text().splitlines()], ['get', 'update', 'get'])
            with State(state_path) as state:
                state.data['items'][identity(task)] = {'listId': task['listId'], 'id': task['id'],
                    'fingerprint': fingerprint(parse(current['notes'])), 'phase': None, 'lastfix': 0,
                    'delivery': 'unknown', 'attempts': 1, 'episode': 1}
                state.save()
            changed = command[:-2]
            changed[changed.index('--revision')+1] = '3'
            changed[changed.index('--delivery-destination')+1] = '238615548420255@lid'
            calls.write_text('')
            result = subprocess.run(changed, env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 1)
            self.assertEqual([json.loads(line)['action'] for line in calls.read_text().splitlines()], ['get'])
            self.assertEqual(next(iter(json.loads(state_path.read_text())['items'].values()))['delivery'], 'unknown')
            # Missing private state/lock fails before any update, not fresh authorization.
            calls.write_text(''); fixture.write_text(json.dumps({'tasks': [task]})); state_path.unlink()
            result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 1)
            self.assertEqual([json.loads(line)['action'] for line in calls.read_text().splitlines()], ['get'])
            self.assertFalse(state_path.exists())

    def test_actual_runner_group_unknown_restart_later_ack_one_reservation(self):
        requests = []; reservations = {}; acknowledged = False
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def respond(self, status, body):
                self.send_response(status); self.end_headers(); self.wfile.write(json.dumps(body).encode())
            def do_POST(self):
                self.assert_route('/family/delivery')
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                requests.append(body)
                from delivery import validate_body
                validate_body(body)
                old = reservations.setdefault(body['key'], body)
                if body != old: return self.respond(409, {'state': 'unknown'})
                self.respond(200 if acknowledged else 202, {'state': 'acknowledged' if acknowledged else 'unknown', 'messageId': 'stable-id'})
            def do_GET(self):
                # End the first CLI cycle with uncertainty, then ACK on restart.
                self.respond(409, {'state': 'unknown'})
            def assert_route(self, route):
                if self.path != route: raise AssertionError('Unexpected route')
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True); worker.start()
        try:
            with tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary); directory.chmod(0o700)
                site = directory/'site'; site.mkdir(); (site/'sitecustomize.py').write_text(SITE_GROUP)
                fixture = directory/'fixture.json'; calls = directory/'calls.jsonl'
                state = directory/'state.json'; config = directory/'config.json'
                clients = {key: str(Path(installed) if Path(installed).is_file() else ROOT/'test-fixtures'/snapshot)
                    for key, installed, snapshot in [('tasks_client', '/opt/hermes-tasks/client.py', 'tasks_client.approved.py'), ('location_client', '/opt/hermes-health/client.py', 'location_client.approved.py')]}
                config.write_text(json.dumps({**clients, 'enabled': False, 'interval_seconds': 300, 'state': str(state), 'sender': str(ROOT/'private_sender.py')}))
                env = {**os.environ, 'PYTHONPATH': str(site), 'NOTES_FIXTURE': str(fixture), 'NOTES_CALLS': str(calls), 'NOTES_TEST_PORT': str(server.server_port)}
                def cli(*extra):
                    return subprocess.run([sys.executable, str(ROOT/'notes_runner.py'), '--config', str(config), *extra], env=env, capture_output=True, text=True, timeout=10)
                self.assertEqual(cli('--initialize-state').returncode, 0)
                data = json.loads(config.read_text()); data['enabled'] = True; config.write_text(json.dumps(data))
                # Synthetic geometry only, through the real broker CLI contract.
                rule = {**RULE, 'latitude': 0, 'longitude': 0,
                        'mapsUrl': 'https://www.google.com/maps', 'revision': 2,
                        'delivery': {'destination': GROUP, 'message': 'Hola'}}
                task = copy.deepcopy(TASK)
                task['notes'] = update_notes('', rule)
                at = time.time()-1
                rows = []
                def write(outside=False, hidden=False):
                    nonlocal at
                    at = max(at+.1, time.time()-.01)
                    loc = {'lat': .004 if outside else 0, 'lon': 0,
                           'h_acc': 19, 'ts': at, 'received_at': at, 'kind': 'location'}
                    rows.append(loc)
                    if hidden:
                        # Latest is coarse; an intervening precise inside must win.
                        rows.append({**loc, 'lat': .0012, 'h_acc': 26})
                        loc = {**loc, 'ts': at+.001, 'received_at': at+.001, 'h_acc': 1414}
                        rows.append(loc)
                    fixture.write_text(json.dumps({'tasks': [task], 'locations': rows,
                        'fix': {'ok': True, 'person': 'dan', 'location': loc}}))
                write(True); self.assertEqual(cli().returncode, 0)  # Arm.
                write(True); self.assertEqual(cli().returncode, 0)  # Post-arm outside.
                write(hidden=True); self.assertEqual(cli().returncode, 1)
                self.assertEqual(next(iter(json.loads(state.read_text())['items'].values()))['delivery'], 'unknown')
                actions = [json.loads(line)['action'] for line in calls.read_text().splitlines()]
                self.assertEqual(actions.count('location'), 3)
                self.assertNotIn('location_latest', actions)
                history_reads = actions.count('location')
                acknowledged = True; task['title'] = 'Changed secret title'; write()
                result = cli(); self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(next(iter(json.loads(state.read_text())['items'].values()))['delivery'], 'sent')
                actions = [json.loads(line)['action'] for line in calls.read_text().splitlines()]
                self.assertEqual(actions.count('location'), history_reads)
                self.assertEqual(len(reservations), 1)
                self.assertEqual(requests[0], requests[1])
                self.assertEqual(requests[0]['component']['content'], 'Hola')
        finally:
            server.shutdown(); server.server_close(); worker.join()
