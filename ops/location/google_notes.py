"""Pure versioned Google Tasks notes rule; no I/O on import."""
from datetime import datetime
import hashlib
import json
import math
import re
from urllib.parse import urlparse

START = '[hermes-location:v1]'
END = '[/hermes-location:v1]'
FIELDS = {'version', 'revision', 'name', 'address', 'mapsUrl', 'latitude', 'longitude', 'radius', 'nearby'}


def validate(rule):
    expected = FIELDS if isinstance(rule, dict) and rule.get('version') == 1 else (FIELDS - {'nearby'}) | {'trigger'}
    if not isinstance(rule, dict) or set(rule) != expected:
        raise ValueError('Invalid location fields')
    if type(rule['version']) is not int or rule['version'] not in (1, 2) or type(rule['revision']) is not int or rule['revision'] < 1:
        raise ValueError('Invalid location version')
    for field in ('name', 'address', 'mapsUrl'):
        if not isinstance(rule[field], str) or not rule[field].strip() or len(rule[field]) > 500 or any(ord(c) < 32 for c in rule[field]) or any(marker in rule[field] for marker in ('[hermes-location:', '[/hermes-location:')):
            raise ValueError('Invalid place text')
    url = urlparse(rule['mapsUrl'])
    if url.scheme != 'https' or url.hostname not in ('maps.google.com', 'www.google.com', 'maps.app.goo.gl') or url.username or url.password:
        raise ValueError('Invalid Maps URL')
    for key, low, high in [('latitude', -90, 90), ('longitude', -180, 180), ('radius', 50, 1000)]:
        x = rule[key]
        if type(x) not in (int, float) or not math.isfinite(x) or not low <= x <= high:
            raise ValueError('Invalid place geometry')
    if rule['version'] == 1:
        if type(rule['nearby']) is not bool:
            raise ValueError('nearby must be explicit')
    else:
        trigger = rule['trigger']
        if not isinstance(trigger, dict):
            raise ValueError('Typed trigger required')
        if trigger.get('type') == 'arrival':
            if set(trigger) != {'type', 'nearby'} or type(trigger['nearby']) is not bool:
                raise ValueError('Invalid arrival trigger')
        elif trigger.get('type') == 'presence_at':
            if set(trigger) != {'type', 'dueAt'}:
                raise ValueError('Invalid presence trigger')
            due_stamp(trigger['dueAt'])
        else:
            raise ValueError('Invalid trigger')
    return rule


def parse(notes):
    if not isinstance(notes, str):
        raise ValueError('Invalid notes')
    # Ordinary user notes are never parsed or warned about.
    if '[hermes-location:' not in notes and '[/hermes-location:' not in notes:
        return None
    versions = [v for v in (1, 2) if f'[hermes-location:v{v}]' in notes]
    if len(versions) != 1:
        raise ValueError('Invalid marked rule')
    start, end = markers(versions[0])
    if notes.count(start) != 1 or notes.count(end) != 1:
        raise ValueError('Invalid marked rule')
    match = re.search(re.escape(start) + r'\n([^\n]+)\n' + re.escape(end), notes)
    if not match or notes.count('[hermes-location:') != 1 or notes.count('[/hermes-location:') != 1:
        raise ValueError('Invalid marked rule')
    def pairs(items):
        result = {}
        for k, v in items:
            if k in result:
                raise ValueError('Duplicate JSON field')
            result[k] = v
        return result
    rule = validate(json.loads(match[1], object_pairs_hook=pairs))
    if rule['version'] != versions[0]:
        raise ValueError('Marker version mismatch')
    return rule


def fingerprint(rule):
    return hashlib.sha256(json.dumps(validate(rule), sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def update_notes(notes, rule):
    """Preserve every unrelated byte, including a trailing root #hermes metadata line."""
    validate(rule)
    old = parse(notes)
    readable = f"Lugar: {rule['name']} — {rule['address']}\nMaps: {rule['mapsUrl']}"
    start, end = markers(rule['version'])
    block = start + '\n' + json.dumps(rule, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n' + end
    if old:
        if rule['revision'] <= old['revision']:
            raise ValueError('Revision must increase')
        old_readable = f"Lugar: {old['name']} — {old['address']}\nMaps: {old['mapsUrl']}\n"
        old_start, old_end = markers(old['version'])
        pattern = re.escape(old_start) + r'\n[^\n]+\n' + re.escape(old_end)
        if old_readable + old_start in notes:
            return re.sub(re.escape(old_readable) + pattern, lambda _: readable + '\n' + block, notes, count=1)
        return re.sub(pattern, lambda _: block, notes, count=1)
    # Keep root metadata last; broker views expose it separately as sourceKey.
    lines = notes.splitlines(keepends=True)
    if lines and lines[-1].startswith('#hermes '):
        metadata = lines.pop()
        body = ''.join(lines)
        return body + ('\n' if body and not body.endswith('\n') else '') + readable + '\n' + block + '\n' + metadata
    return notes + ('\n\n' if notes else '') + readable + '\n' + block


def markers(version):
    return f'[hermes-location:v{version}]', f'[/hermes-location:v{version}]'

def due_stamp(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})', value):
        raise ValueError('Timezone-aware ISO dueAt required')
    if int(value[11:13]) > 23 or int(value[14:16]) > 59 or int(value[17:19]) > 59:
        raise ValueError('Invalid ISO clock')
    # datetime rejects impossible calendar dates instead of normalizing them.
    if value[-1] != 'Z' and (int(value[-5:-3]) > 23 or int(value[-2:]) > 59):
        raise ValueError('Invalid timezone offset')
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()

def trigger(rule):
    return rule.get('trigger', {'type': 'arrival', 'nearby': rule.get('nearby', False)})
