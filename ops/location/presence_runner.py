#!/usr/bin/env python3
"""One-shot conditional presence, never arrival detection or task completion."""
import argparse
import json
import math
from pathlib import Path
import re
import signal
import sys
import time
from notes_runner import Runtime, TASKS, LOCATION, distance, stamp
from presence_state import State
from private_sender import PRIVATE_DESTINATION


def validate(config):
    if type(config.get('enabled')) is not bool:
        raise ValueError('enabled must be boolean')
    for key in ('state', 'sender', 'tasks_client', 'location_client'):
        path = Path(config.get(key, {'tasks_client': TASKS, 'location_client': LOCATION}.get(key, '')))
        if not path.is_absolute() or '..' in path.parts:
            raise ValueError('Absolute paths required')
        if key != 'state' and not path.is_file():
            raise ValueError({'tasks_client': 'Tasks broker unavailable', 'location_client': 'Location broker unavailable', 'sender': 'Private transport client unavailable'}[key])
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', config.get('operation_id', '')):
        raise ValueError('Fresh stable operation id required')
    task = config.get('task', {})
    if set(task) != {'owner', 'id', 'listId', 'sourceKey'} or task['owner'] != 'Dani' or any(not isinstance(v, str) or not v for v in task.values()):
        raise ValueError('Canonical task identity required')
    fence = config.get('geofence', {})
    if set(fence) != {'latitude', 'longitude', 'radius'} or any(type(v) not in (int, float) or not math.isfinite(v) for v in fence.values()) or not -90 <= fence['latitude'] <= 90 or not -180 <= fence['longitude'] <= 180 or fence['radius'] != 100:
        raise ValueError('Confirmed finite geofence required')
    if not isinstance(config.get('message'), str) or not 1 <= len(config['message']) <= 2000:
        raise ValueError('Immutable message required')


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


def inspect(config, runtime, clock):
    try:
        task = runtime.tasks('get', {'id': config['task']['id']})['task']
    except Exception as exc:
        raise ValueError('Tasks broker unavailable') from exc
    if task is None:
        return 'cancelled'
    if not isinstance(task, dict) or any(task.get(k) != v for k, v in config['task'].items()):
        raise ValueError('Task identity mismatch')
    if task.get('deleted') is True or task.get('done') is True or task.get('completed') not in (None, ''):
        return 'cancelled'
    if task.get('done') is not False:
        raise ValueError('Task status unavailable')
    try:
        code, output = runtime.call([sys.executable, config.get('location_client', LOCATION), 'where', 'dan', '--tz', 'Europe/Madrid'])
        if code:
            raise ValueError('Location broker unavailable')
        fix = json.loads(output)
    except Exception as exc:
        raise ValueError('Location broker unavailable') from exc
    if not isinstance(fix, dict) or fix.get('ok') is not True:
        raise ValueError('Location broker unavailable')
    now = clock()  # Only after the broker read completes.
    return presence(fix, config['geofence'], now)


def run(config, check=False, initialize=False, clock=time.time):
    if initialize:
        if config.get('enabled') is not False:
            raise ValueError('Initialize disabled state only')
        with State(config['state'], initialize=True):
            return 'initialized'
    if not check and config.get('enabled') is False:
        return 'disabled'
    validate(config)
    runtime = Runtime(config)
    def stop(signum, frame):
        if runtime.child:
            import os
            os.killpg(runtime.child.pid, signal.SIGKILL)
        print('presence: FAIL: Runtime interrupted' if check else 'La comprobación de presencia fue interrumpida. No puedo confirmar el resultado del recordatorio de hacer arroz; se conserva el estado del envío.', file=sys.stderr)
        raise SystemExit(128+signum)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    if check:
        return inspect(config, runtime, clock)  # No ledger/claim/send.
    body = {'destination': PRIVATE_DESTINATION, 'message': config['message'],
            'idempotency_key': 'presence:v1:' + config['operation_id']}
    with State(config['state']) as state:
        claim = state.data['claim']
        if claim and claim['body'] != body:
            raise ValueError('Immutable operation mismatch; use a separate fresh state')
        if claim and claim['status'] in ('sent', 'cancelled', 'skipped'):
            return claim['status']
        reason = inspect(config, runtime, clock)
        if reason != 'inside':
            # Unknown reservation must remain reconcilable, never replaced.
            if not claim or claim['status'] == 'retry':
                state.data['claim'] = {'body': body, 'status': 'cancelled' if reason == 'cancelled' else 'skipped'}
                state.save()
            if claim and claim['status'] == 'unknown':
                raise ValueError('Private delivery unknown')
            return reason
        was_unknown = bool(claim and claim['status'] == 'unknown')
        state.data['claim'] = {'body': body, 'status': 'unknown'}
        state.save()  # Durable locked claim BEFORE external send.
        # Only exit 75 certifies no reservation; retry once within Runtime's
        # existing total deadline. Unknown claims never enter this retry branch.
        for attempt in range(2):
            try:
                result = runtime.send(body)
            except Exception:
                result = 'unknown'
            if result != 'unavailable' or was_unknown or attempt == 1:
                break
        if result == 'acknowledged':
            state.data['claim']['status'] = 'sent'
        elif result == 'unavailable' and not was_unknown:
            state.data['claim']['status'] = 'retry'
        state.save()
        if result != 'acknowledged':
            raise ValueError('Private delivery ' + ('unknown' if was_unknown else result))
        return 'sent'


OUTCOMES = {
    'sent': '',  # The private adapter already delivered the rice notice.
    'stale': 'No pude confirmar que siguieras en casa: la ubicación tiene más de cinco minutos. No he enviado el recordatorio de hacer arroz.',
    'uncertain': 'No pude confirmar que siguieras en casa: la ubicación no es suficientemente fiable. No he enviado el recordatorio de hacer arroz.',
    'outside': 'La ubicación indica que estás fuera de casa. No he enviado el recordatorio de hacer arroz.',
    'cancelled': 'La tarea está cancelada o completada. No he enviado el recordatorio de hacer arroz.',
    'skipped': 'La comprobación anterior no confirmó que siguieras en casa. No he enviado el recordatorio de hacer arroz.',
    'disabled': 'La comprobación de presencia está desactivada. No he enviado el recordatorio de hacer arroz.',
    'initialized': 'Estado de presencia inicializado; no se ha enviado ningún recordatorio.',
}
ERRORS = {
    'Task identity mismatch': 'El broker de tareas canónicas devolvió una identidad incorrecta. No se ha intentado un nuevo envío del recordatorio de hacer arroz.',
    'Task status unavailable': 'El broker de tareas canónicas no confirmó el estado de la tarea. No se ha intentado un nuevo envío del recordatorio de hacer arroz.',
    'Tasks broker unavailable': 'No pude consultar el broker de tareas canónicas: respuesta inválida o servicio no disponible.',
    'Location broker unavailable': 'No pude consultar el broker de ubicación (health): respuesta inválida o servicio no disponible.',
    'Private transport client unavailable': 'El cliente del transporte privado no está disponible. No se ha intentado enviar el recordatorio de hacer arroz.',
    'Private delivery unavailable': 'El transporte privado no está disponible; no reservó el envío del recordatorio de hacer arroz tras dos intentos con la misma clave.',
    'Private delivery unknown': 'El transporte privado no confirmó la recepción: el recordatorio de hacer arroz puede haberse enviado. Se conserva la misma clave de envío; no se iniciará otro envío con una clave nueva.',
    'Immutable operation mismatch; use a separate fresh state': 'La configuración no coincide con la operación guardada. Se conserva su estado; no se ha intentado otro envío.',
}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--initialize-state', action='store_true')
    args = parser.parse_args()
    try:
        result = run(json.loads(args.config.read_text()), args.check, args.initialize_state)
        output = 'presence: ' + result if args.check else OUTCOMES[result]
        if output:
            print(output)
    except Exception as exc:
        # Fixed diagnostics only; no broker output, title, coordinates or notes.
        safe = str(exc) if type(exc) is ValueError and str(exc) in ERRORS else 'Configuration or client read failed'
        output = 'presence: FAIL: ' + safe if args.check else ERRORS.get(safe, 'No pude ejecutar la comprobación de presencia: fallo de configuración o del estado guardado. No puedo confirmar el resultado del recordatorio de hacer arroz.')
        print(output, file=sys.stderr)
        sys.exit(1)
