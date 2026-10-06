# Presence outcome correction

The user requires resilience or visible errors; silent failures are unacceptable.
This supersedes historical local-only/silent-diagnostic acceptance in the preserved
`PRESENCE-REVIEW.md`. This is implementation evidence, not self-approval or proof
of live delivery. Parent must perform a fresh review of these scoped changes.

Only this correction changes `ops/location/presence_runner.py`,
`ops/location/test_presence.py`, the disabled-output assertion in
`ops/location/test_install.py`, and `ops/location/PRESENCE-IMPLEMENTATION.md`.
All other pre-existing uncommitted changes remain as received. No core/client,
profile, active config/cron, installation, commit, push, live read or send occurred.
The canonical task, source key, rice body, geofence and <=300-second condition
policy remain unchanged; missing/uncertain fixes are never assumed outside.

Regular shell CLI: acknowledged and already-sent stdout is empty. Stale/uncertain,
outside and cancelled have explicit Spanish stdout and no rice notice. Runtime
errors exit nonzero with Spanish stderr identifying tasks/health/transport, without
raw broker data. Unknown claims are retained across restart, including false
conditions, and report that the notice may have been sent, reception unconfirmed.
Only known pre-reservation unavailable can retry once (max two attempts per run),
using the same immutable body/key and existing child/165-second total deadline.
Unknown has no additional immediate retry, no new key, no queue. `--check` retains
`presence: ...` diagnostic output and stays read-only. Arrival wrapper stays silent.

Parent-only cron command after verified merged installation/readiness:

```sh
HERMES_HOME=/home/hermes/.hermes /home/hermes/.hermes/hermes-agent/venv/bin/hermes cron create 'in 5m' --name location-presence-once --script location-presence-once.sh --no-agent --deliver whatsapp:238615548420255@lid --failure-deliver whatsapp:238615548420255@lid
```

Both outcomes use existing scheduler delivery hooks to the same private Dani DM.
Diagnostic delivery is not gated by the rice adapter receipt. Parent must verify
actual callback status/failure tracking; code tests do not prove that live hook.
Healthy brokers with a stale baseline permit the timed attempt; read errors must
be reported. The authorized five-minute clock starts only after verified installed
readiness and new one-shot creation. No timer was started by this correction.

Test changes: actual shell success and repeated success assert empty stdout;
outside/stale/uncertain/cancelled assert readable Spanish; broker failures assert
nonzero Spanish stderr; unknown (including false condition and subsequent 75)
asserts uncertainty with no false “No he enviado”; unavailable recovery asserts
exactly two identical bodies; existing unavailable sequence now expects five calls
because its first known-unavailable run retries once. Disabled installer assertion
now matches Spanish. Existing arrival coverage remains in full discovery.

Validation: one full offline discovery passed **85 tests in 64.727s**, no skips
or failures (received suite: 82, plus three meaningful new presence tests).
After the final diagnostic wording/path classification adjustment, focused
presence discovery passed **11 tests in 6.798s**. `git diff --check` passed.

```sh
PYTHONDONTWRITEBYTECODE=1 /home/hermes/.hermes/hermes-agent/venv/bin/python -m unittest discover -s ops/location -v
PYTHONDONTWRITEBYTECODE=1 /home/hermes/.hermes/hermes-agent/venv/bin/python -m unittest discover -s ops/location -p test_presence.py -v
```

Logs: `/tmp/presence-correction-tests.log` and
`/tmp/presence-correction-focused.log`. No heavy app build was run.

Exact incremental runner diff against the received reviewed implementation:

```diff
--- before/ops/location/presence_runner.py
+++ after/ops/location/presence_runner.py
@@ -21,7 +21,7 @@
         if not path.is_absolute() or '..' in path.parts:
             raise ValueError('Absolute paths required')
         if key != 'state' and not path.is_file():
-            raise ValueError('Client script unavailable')
+            raise ValueError({'tasks_client': 'Tasks broker unavailable', 'location_client': 'Location broker unavailable', 'sender': 'Private transport client unavailable'}[key])
     if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', config.get('operation_id', '')):
         raise ValueError('Fresh stable operation id required')
     task = config.get('task', {})
@@ -55,7 +55,10 @@
 
 
 def inspect(config, runtime, clock):
-    task = runtime.tasks('get', {'id': config['task']['id']})['task']
+    try:
+        task = runtime.tasks('get', {'id': config['task']['id']})['task']
+    except Exception as exc:
+        raise ValueError('Tasks broker unavailable') from exc
     if task is None:
         return 'cancelled'
     if not isinstance(task, dict) or any(task.get(k) != v for k, v in config['task'].items()):
@@ -64,10 +67,13 @@
         return 'cancelled'
     if task.get('done') is not False:
         raise ValueError('Task status unavailable')
-    code, output = runtime.call([sys.executable, config.get('location_client', LOCATION), 'where', 'dan', '--tz', 'Europe/Madrid'])
-    if code:
-        raise ValueError('Location broker unavailable')
-    fix = json.loads(output)
+    try:
+        code, output = runtime.call([sys.executable, config.get('location_client', LOCATION), 'where', 'dan', '--tz', 'Europe/Madrid'])
+        if code:
+            raise ValueError('Location broker unavailable')
+        fix = json.loads(output)
+    except Exception as exc:
+        raise ValueError('Location broker unavailable') from exc
     if not isinstance(fix, dict) or fix.get('ok') is not True:
         raise ValueError('Location broker unavailable')
     now = clock()  # Only after the broker read completes.
@@ -88,6 +94,7 @@
         if runtime.child:
             import os
             os.killpg(runtime.child.pid, signal.SIGKILL)
+        print('presence: FAIL: Runtime interrupted' if check else 'La comprobación de presencia fue interrumpida. No puedo confirmar el resultado del recordatorio de hacer arroz; se conserva el estado del envío.', file=sys.stderr)
         raise SystemExit(128+signum)
     signal.signal(signal.SIGTERM, stop)
     signal.signal(signal.SIGINT, stop)
@@ -107,19 +114,51 @@
             if not claim or claim['status'] == 'retry':
                 state.data['claim'] = {'body': body, 'status': 'cancelled' if reason == 'cancelled' else 'skipped'}
                 state.save()
+            if claim and claim['status'] == 'unknown':
+                raise ValueError('Private delivery unknown')
             return reason
         was_unknown = bool(claim and claim['status'] == 'unknown')
         state.data['claim'] = {'body': body, 'status': 'unknown'}
         state.save()  # Durable locked claim BEFORE external send.
-        result = runtime.send(body)
+        # Only exit 75 certifies no reservation; retry once within Runtime's
+        # existing total deadline. Unknown claims never enter this retry branch.
+        for attempt in range(2):
+            try:
+                result = runtime.send(body)
+            except Exception:
+                result = 'unknown'
+            if result != 'unavailable' or was_unknown or attempt == 1:
+                break
         if result == 'acknowledged':
             state.data['claim']['status'] = 'sent'
         elif result == 'unavailable' and not was_unknown:
             state.data['claim']['status'] = 'retry'
         state.save()
         if result != 'acknowledged':
-            raise ValueError('Private delivery ' + result)
+            raise ValueError('Private delivery ' + ('unknown' if was_unknown else result))
         return 'sent'
+
+
+OUTCOMES = {
+    'sent': '',  # The private adapter already delivered the rice notice.
+    'stale': 'No pude confirmar que siguieras en casa: la ubicación tiene más de cinco minutos. No he enviado el recordatorio de hacer arroz.',
+    'uncertain': 'No pude confirmar que siguieras en casa: la ubicación no es suficientemente fiable. No he enviado el recordatorio de hacer arroz.',
+    'outside': 'La ubicación indica que estás fuera de casa. No he enviado el recordatorio de hacer arroz.',
+    'cancelled': 'La tarea está cancelada o completada. No he enviado el recordatorio de hacer arroz.',
+    'skipped': 'La comprobación anterior no confirmó que siguieras en casa. No he enviado el recordatorio de hacer arroz.',
+    'disabled': 'La comprobación de presencia está desactivada. No he enviado el recordatorio de hacer arroz.',
+    'initialized': 'Estado de presencia inicializado; no se ha enviado ningún recordatorio.',
+}
+ERRORS = {
+    'Task identity mismatch': 'El broker de tareas canónicas devolvió una identidad incorrecta. No se ha intentado un nuevo envío del recordatorio de hacer arroz.',
+    'Task status unavailable': 'El broker de tareas canónicas no confirmó el estado de la tarea. No se ha intentado un nuevo envío del recordatorio de hacer arroz.',
+    'Tasks broker unavailable': 'No pude consultar el broker de tareas canónicas: respuesta inválida o servicio no disponible.',
+    'Location broker unavailable': 'No pude consultar el broker de ubicación (health): respuesta inválida o servicio no disponible.',
+    'Private transport client unavailable': 'El cliente del transporte privado no está disponible. No se ha intentado enviar el recordatorio de hacer arroz.',
+    'Private delivery unavailable': 'El transporte privado no está disponible; no reservó el envío del recordatorio de hacer arroz tras dos intentos con la misma clave.',
+    'Private delivery unknown': 'El transporte privado no confirmó la recepción: el recordatorio de hacer arroz puede haberse enviado. Se conserva la misma clave de envío; no se iniciará otro envío con una clave nueva.',
+    'Immutable operation mismatch; use a separate fresh state': 'La configuración no coincide con la operación guardada. Se conserva su estado; no se ha intentado otro envío.',
+}
 
 
 if __name__ == '__main__':
@@ -129,9 +168,13 @@
     parser.add_argument('--initialize-state', action='store_true')
     args = parser.parse_args()
     try:
-        print('presence: ' + run(json.loads(args.config.read_text()), args.check, args.initialize_state))
+        result = run(json.loads(args.config.read_text()), args.check, args.initialize_state)
+        output = 'presence: ' + result if args.check else OUTCOMES[result]
+        if output:
+            print(output)
     except Exception as exc:
         # Fixed diagnostics only; no broker output, title, coordinates or notes.
-        safe = str(exc) if type(exc) is ValueError and str(exc) in ('Task identity mismatch', 'Task status unavailable', 'Tasks broker unavailable', 'Location broker unavailable', 'Private delivery unavailable', 'Private delivery unknown', 'Immutable operation mismatch; use a separate fresh state') else 'Configuration or client read failed'
-        print('presence: FAIL: ' + safe, file=sys.stderr)
+        safe = str(exc) if type(exc) is ValueError and str(exc) in ERRORS else 'Configuration or client read failed'
+        output = 'presence: FAIL: ' + safe if args.check else ERRORS.get(safe, 'No pude ejecutar la comprobación de presencia: fallo de configuración o del estado guardado. No puedo confirmar el resultado del recordatorio de hacer arroz.')
+        print(output, file=sys.stderr)
         sys.exit(1)
```
