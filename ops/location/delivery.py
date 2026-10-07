"""Explicit allowlisted delivery and separate loopback group receipt adapter."""
import hashlib
import http.client
import json
import re
import sys
import time
from private_sender import Unavailable

PRIVATE = '238615548420255@lid'
GROUP = '120363411293061762@g.us'


def validate_delivery(value):
    if (not isinstance(value, dict) or set(value) != {'destination', 'message'}
            or value['destination'] not in (PRIVATE, GROUP)
            or not isinstance(value['message'], str) or not value['message'].strip()
            or len(value['message']) > 2000
            or any(ord(c) < 32 or ord(c) == 127 for c in value['message'])
            or '[hermes-location:' in value['message'] or '[/hermes-location:' in value['message']):
        raise ValueError('Invalid explicit delivery')
    return value


def validate_body(body):
    if (not isinstance(body, dict) or set(body) != {'key', 'destination', 'component'}
            or body['destination'] != GROUP or not isinstance(body['key'], str)
            or not re.fullmatch('[a-f0-9]{64}', body['key'])):
        raise ValueError('Invalid group body')
    p = body['component']
    if (not isinstance(p, dict) or set(p) != {'id', 'kind', 'content'}
            or p['id'] != body['key'] or p['kind'] != 'text'):
        raise ValueError('Invalid group component')
    validate_delivery({'destination': GROUP, 'message': p['content']})
    return body


def snapshot(body):
    if 'component' in body:
        validate_body(body)
        return {'transport': 'group', 'schema': 1, 'body': body}
    from private_sender import PRIVATE_DESTINATION
    if (set(body) != {'destination', 'message', 'idempotency_key'}
            or body['destination'] != PRIVATE_DESTINATION
            or not isinstance(body['message'], str) or not 1 <= len(body['message']) <= 2000
            or not isinstance(body['idempotency_key'], str) or not body['idempotency_key']
            or len(body['idempotency_key']) > 512):
        raise ValueError('Invalid private claim')
    return {'transport': 'private', 'schema': 1, 'body': body}


def validate_snapshot(value):
    if (not isinstance(value, dict) or set(value) != {'transport', 'schema', 'body'}
            or type(value['schema']) is not int or value['schema'] != 1
            or snapshot(value['body']) != value):
        raise ValueError('Invalid immutable delivery')


def explicit_body(item, delivery):
    validate_delivery(delivery)
    key = hashlib.sha256(json.dumps(['google-location:explicit:v1', 'Dani', item['listId'],
        item['id'], item['fingerprint'], item['episode']], separators=(',', ':')).encode()).hexdigest()
    if delivery['destination'] == GROUP:
        return {'key': key, 'destination': GROUP,
                'component': {'id': key, 'kind': 'text', 'content': delivery['message']}}
    return {'destination': PRIVATE, 'message': delivery['message'],
            'idempotency_key': 'google-location:explicit:v1:' + key}


def send(body, connect=None, clock=time.monotonic, sleep=time.sleep):
    validate_body(body)
    deadline = clock() + 18
    expected_id = None
    uncertain = False
    post = True
    while clock() < deadline:
        connection = (connect or (lambda: http.client.HTTPConnection('127.0.0.1', 3000, timeout=3)))()
        try:
            connection.request('POST' if post else 'GET', '/family/delivery' if post else '/family/delivery/' + body['key'],
                               json.dumps(body) if post else None, {'Content-Type': 'application/json'})
            response = connection.getresponse()
            result = json.loads(response.read(4096))
            # Only exact documented pre-reservation evidence. Disabled, conflicts,
            # socket failures and malformed responses remain unknown.
            definitive = (post and ((response.status == 503 and result == {'state': 'definitive_failure'})
                or (response.status in (400, 413) and result == {'state': 'definitive_failure',
                    'preReservation': True, 'reason': 'invalid_payload' if response.status == 400 else 'invalid_body'})
                or (response.status == 400 and result == {'state': 'definitive_failure', 'preReservation': True, 'reason': 'invalid_body'})))
            if definitive and not uncertain:
                raise Unavailable('Rejected before reservation')
            identifier = result.get('messageId')
            if (response.status in (200, 202) and result.get('state') in ('unknown', 'acknowledged')
                    and isinstance(identifier, str) and identifier and (expected_id is None or expected_id == identifier)):
                expected_id = identifier
                if response.status == 200 and result['state'] == 'acknowledged':
                    return
                uncertain = True
                post = False
            elif not post and response.status == 404 and result == {'state': 'absent'}:
                # Same key/body only; never erase earlier uncertainty.
                post = True
            else:
                raise TimeoutError('Group delivery unresolved')
        finally:
            connection.close()
        sleep(min(1, max(0, deadline-clock())))
    raise TimeoutError('Group acknowledgement unresolved')


if __name__ == '__main__':
    try:
        send(json.loads(sys.stdin.read(16384)))
    except Unavailable:
        print('Group rejected before reservation.', file=sys.stderr)
        sys.exit(75)
    except Exception:
        print('Group delivery unresolved.', file=sys.stderr)
        sys.exit(1)
