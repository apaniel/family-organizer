"""Single private claim; reuse reviewed JSON locking and durable writes."""
from notes_state import State as JSONState
from private_sender import PRIVATE_DESTINATION


def validate(data):
    if not isinstance(data, dict) or set(data) != {'version', 'claim'} or type(data['version']) is not int or data['version'] != 1:
        raise ValueError('Invalid presence state')
    claim = data['claim']
    if claim is not None:
        if not isinstance(claim, dict) or set(claim) != {'body', 'status'} or claim['status'] not in ('unknown', 'retry', 'sent', 'cancelled', 'skipped'):
            raise ValueError('Invalid presence claim')
        body = claim['body']
        if not isinstance(body, dict) or set(body) != {'destination', 'message', 'idempotency_key'} or body['destination'] != PRIVATE_DESTINATION:
            raise ValueError('Invalid presence body')
        if any(not isinstance(body[k], str) or not 1 <= len(body[k]) <= limit for k, limit in [('message', 2000), ('idempotency_key', 512)]):
            raise ValueError('Invalid immutable body')
    return data


class State(JSONState):
    validator = staticmethod(validate)
    initial = {'version': 1, 'claim': None}
