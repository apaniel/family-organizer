import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import presence_runner as runner
from presence_state import State

ROOT = Path(__file__).parent


class PresenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.root.chmod(0o700)
        self.config = json.loads((ROOT/'presence-config.example.json').read_text())
        self.config.update(enabled=True, operation_id='new-retry-fixture', state=str(self.root/'state.json'), sender=str(self.root/'sender.py'), tasks_client=str(self.root/'tasks.py'), location_client=str(self.root/'health.py'))
        self.task = dict(self.config['task'], done=False)
        now = time.time()
        self.fix = {'ok': True, 'person': 'dan', 'location': {'lat': 41.3970791, 'lon': 2.1465232, 'h_acc': 10, 'ts': now-1, 'received_at': now}}
        self.files()
        with State(self.config['state'], initialize=True):
            pass
        self.configfile = self.root/'config.json'
        wrapper = (ROOT/'presence-cron-entry.sh').read_text().replace('/home/hermes/.hermes/hermes-agent/venv/bin/python', sys.executable).replace('/home/hermes/.hermes/local-customizations/location-runtime/current/ops/location/presence_runner.py', str(ROOT.resolve()/'presence_runner.py'))
        self.wrapper = self.root/'entry.sh'; self.wrapper.write_text(wrapper)

    def tearDown(self):
        self.temp.cleanup()

    def files(self, task_code=0, health_code=0, send_code=0):
        (self.root/'tasks.py').write_text('import json,sys\nassert sys.argv[1]=="get"\np=json.load(sys.stdin)\nassert p=='+repr({'id': self.config['task']['id']})+'\nprint('+repr(json.dumps({'task': self.task}))+')\nsys.exit('+str(task_code)+')\n')
        (self.root/'health.py').write_text('import sys\nprint('+repr(json.dumps(self.fix))+')\nsys.exit('+str(health_code)+')\n')
        (self.root/'sender.py').write_text('import json,sys\nfrom pathlib import Path\nb=json.load(sys.stdin)\np=Path('+repr(str(self.root/'bodies'))+')\nwith p.open("a") as f:f.write(json.dumps(b)+"\\n")\nsys.exit('+str(send_code)+')\n')

    def cli(self, *args):
        self.configfile.write_text(json.dumps(self.config))
        return subprocess.run(['bash', str(self.wrapper), *args], env={**os.environ, 'LOCATION_PRESENCE_CONFIG': str(self.configfile), 'PYTHONDONTWRITEBYTECODE': '1'}, capture_output=True, text=True, timeout=10)

    def test_inside_ack_and_reexecution_no_second_transport(self):
        first = self.cli(); self.assertEqual(first.returncode, 0); self.assertEqual(first.stdout, '')
        repeated = self.cli(); self.assertEqual(repeated.returncode, 0); self.assertEqual(repeated.stdout, '')
        bodies = (self.root/'bodies').read_text().splitlines()
        self.assertEqual(len(bodies), 1)
        self.assertEqual(json.loads(bodies[0])['message'], self.config['message'])
        ledger = Path(self.config['state']).read_text()
        self.assertNotIn('latitude', ledger)
        self.assertNotIn('history', ledger)

    def test_outside_stale_uncertain_future_and_boundary(self):
        now = time.time()
        for changes, reason in [({'lat': 41.5}, 'outside'), ({'ts': now-301, 'received_at': now-301}, 'stale'), ({'h_acc': 101}, 'uncertain'), ({'ts': now+30, 'received_at': now+30}, 'uncertain'), ({'ts': float('nan')}, 'uncertain'), ({'h_acc': 100}, 'inside')]:
            fix = copy.deepcopy(self.fix); fix['location'].update(changes)
            self.assertEqual(runner.presence(fix, self.config['geofence'], now), reason)
        self.fix['location']['lat'] = 41.5; self.files()
        result = self.cli(); self.assertEqual(result.returncode, 0); self.assertIn('fuera de casa', result.stdout); self.assertIn('No he enviado', result.stdout)
        self.assertFalse((self.root/'bodies').exists())
        self.fix['location'].update(lat=41.3970791, ts=now-301, received_at=now-301)
        self.files()
        result = self.cli('--check'); self.assertEqual(result.returncode, 0); self.assertIn('stale', result.stdout)

    def test_cancelled_and_wrong_identity(self):
        for field, value in [('done', True), ('deleted', True)]:
            with self.subTest(field=field):
                self.task[field] = value; self.files()
                self.assertIn('cancelled', self.cli('--check').stdout)
                del self.task[field]
        self.task['done'] = False
        for field in ('owner', 'id', 'listId', 'sourceKey'):
            original = self.task[field]; self.task[field] = 'wrong'; self.files()
            result = self.cli('--check'); self.assertNotEqual(result.returncode, 0); self.assertIn('identity mismatch', result.stderr)
            self.task[field] = original

    def test_broker_errors_fail_nonzero(self):
        for task_code, health_code in [(1, 0), (0, 1)]:
            self.files(task_code, health_code)
            result = self.cli(); self.assertNotEqual(result.returncode, 0); self.assertIn('No pude consultar el broker', result.stderr); self.assertEqual(result.stdout, '')
            self.assertFalse((self.root/'bodies').exists())
            with State(self.config['state']) as state:self.assertIsNone(state.data['claim'])

    def test_health_rejected_response_is_failure(self):
        self.fix = {'ok': False, 'error': 'blocked'}; self.files()
        result = self.cli(); self.assertNotEqual(result.returncode, 0)
        self.assertIn('broker de ubicación (health)', result.stderr)

    def test_read_only_check_and_clock_after_location(self):
        before = Path(self.config['state']).read_bytes()
        self.assertIn('inside', self.cli('--check').stdout)
        self.assertEqual(Path(self.config['state']).read_bytes(), before)
        self.assertFalse((self.root/'bodies').exists())
        runtime = runner.Runtime(self.config)
        with patch.object(runtime, 'call', wraps=runtime.call) as call:
            def clock():
                self.assertEqual(call.call_count, 2)
                return time.time()
            self.assertEqual(runner.inspect(self.config, runtime, clock), 'inside')

    def test_sender_unavailable_unknown_and_ack_stable_body(self):
        for code in (75, 1, 75, 0):
            self.files(send_code=code)
            result = self.cli()
            self.assertEqual(result.returncode, 0 if code == 0 else 1)
            if code == 1 or (code == 75 and len((self.root/'bodies').read_text().splitlines()) > 2):
                self.assertIn('puede haberse enviado', result.stderr)
                self.assertNotIn('No he enviado', result.stderr)
        bodies = [json.loads(x) for x in (self.root/'bodies').read_text().splitlines()]
        self.assertTrue(all(x == bodies[0] for x in bodies))
        self.assertEqual(bodies[0]['idempotency_key'], 'presence:v1:new-retry-fixture')
        self.config['message'] = 'changed'
        self.assertNotEqual(self.cli().returncode, 0)
        self.assertEqual(len((self.root/'bodies').read_text().splitlines()), 5)


    def test_regular_stale_uncertain_and_cancelled_human_outcomes(self):
        for reason in ('stale', 'uncertain', 'cancelled'):
            with self.subTest(reason=reason):
                with State(self.config['state']) as state:
                    state.data['claim'] = None; state.save()
                if reason == 'stale':
                    self.fix['location'].update(ts=time.time()-301, received_at=time.time()-301)
                elif reason == 'uncertain':
                    self.fix['location']['h_acc'] = 101
                else:
                    self.task['done'] = True
                self.files()
                result = self.cli()
                self.assertEqual(result.returncode, 0)
                self.assertIn('No he enviado el recordatorio de hacer arroz.', result.stdout)
                self.assertIn('tarea está cancelada' if reason == 'cancelled' else 'No pude confirmar que siguieras en casa: la ubicación', result.stdout)
                self.assertFalse((self.root/'bodies').exists())

    def test_unknown_claim_with_false_condition_reports_uncertainty(self):
        self.files(send_code=1)
        self.assertEqual(self.cli().returncode, 1)
        before = Path(self.config['state']).read_bytes()
        self.fix['location']['ts'] = time.time()-301; self.files()
        result = self.cli()
        self.assertEqual(result.returncode, 1)
        self.assertIn('puede haberse enviado', result.stderr)
        self.assertNotIn('No he enviado', result.stderr)
        self.assertEqual(result.stdout, '')
        self.assertEqual(Path(self.config['state']).read_bytes(), before)
        self.assertEqual(len((self.root/'bodies').read_text().splitlines()), 1)

    def test_unavailable_retries_once_same_key_and_can_recover(self):
        self.files(send_code=75)
        sender = self.root/'sender.py'
        sender.write_text(sender.read_text().replace('sys.exit(75)', 'sys.exit(75 if len(p.read_text().splitlines()) == 1 else 0)'))
        result = self.cli()
        self.assertEqual(result.returncode, 0); self.assertEqual(result.stdout, '')
        bodies = (self.root/'bodies').read_text().splitlines()
        self.assertEqual(len(bodies), 2); self.assertEqual(bodies[0], bodies[1])

    def test_process_crash_leaves_durable_claim_reused(self):
        # Crash after observing body, before returning a receipt.
        with (self.root/'sender.py').open('a') as f:f.write('')
        script = (self.root/'sender.py').read_text().replace('sys.exit(0)', 'import os,signal\nos.kill(os.getppid(), signal.SIGKILL)')
        (self.root/'sender.py').write_text(script)
        self.assertNotEqual(self.cli().returncode, 0)
        with State(self.config['state']) as state:self.assertEqual(state.data['claim']['status'], 'unknown')
        self.files(); self.assertEqual(self.cli().returncode, 0)
        bodies = (self.root/'bodies').read_text().splitlines(); self.assertEqual(bodies[0], bodies[1])
