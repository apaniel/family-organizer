#!/home/hermes/.hermes/hermes-agent/venv/bin/python
"""Private Hermes bot bridge adapter. Zero exit requires a durable recipient receipt."""
import http.client
import json
import sys
import time
PRIVATE_DESTINATION = '238615548420255@lid'


class Unavailable(Exception):
    """Bridge explicitly rejected before journal reservation/socket send."""


def send(body, connect=None, clock=time.monotonic, sleep=time.sleep):
    if (not isinstance(body, dict) or set(body) != {'destination', 'message', 'idempotency_key'}
        or body['destination'] != PRIVATE_DESTINATION
        or not isinstance(body['message'], str) or not body['message'].strip()
        or len(body['message']) > 2000
        or not isinstance(body['idempotency_key'], str) or not body['idempotency_key']
        or len(body['idempotency_key']) > 512):
        raise ValueError('Invalid private notice')
    deadline = clock() + 18
    expected_id = None
    while clock() < deadline:
        connection = (connect or (lambda: http.client.HTTPConnection('127.0.0.1', 3000, timeout=3)))()
        try:
            connection.request('POST', '/family/private-notice', json.dumps(body), {'Content-Type': 'application/json'})
            response = connection.getresponse()
            result = json.loads(response.read(4096))
            if response.status == 503 and result == {'state': 'unavailable'}:
                if expected_id:
                    raise TimeoutError('Earlier reservation remains uncertain')
                raise Unavailable('Bridge unavailable before reservation')
            identifier = result.get('messageId')
            if not isinstance(identifier, str) or not identifier or (expected_id and expected_id != identifier):
                raise ValueError('Receipt mismatch')
            expected_id = identifier
            if response.status == 200 and result.get('state') == 'acknowledged':
                return
            if response.status != 202 or result.get('state') != 'uncertain':
                raise ValueError('Unresolved private transport')
        finally:
            connection.close()
        sleep(min(1, max(0, deadline-clock())))
    raise TimeoutError('Private receipt unresolved')


if __name__ == '__main__':
    try:
        send(json.loads(sys.stdin.read(16384)))
    except Unavailable:
        print('Private bridge unavailable before reservation.', file=sys.stderr)
        sys.exit(75)
    except Exception:
        print('Private delivery unresolved; no acknowledgement confirmed.', file=sys.stderr)
        sys.exit(1)
