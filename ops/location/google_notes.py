"""Pure versioned Google Tasks notes rule; no I/O on import."""
import hashlib
import json
import math
import re
from urllib.parse import urlparse

START = '[hermes-location:v1]'
END = '[/hermes-location:v1]'
FIELDS = {'version', 'revision', 'name', 'address', 'mapsUrl', 'latitude', 'longitude', 'radius', 'nearby'}


def validate(rule):
    if not isinstance(rule, dict) or set(rule) != FIELDS:
        raise ValueError('Invalid location fields')
    if type(rule['version']) is not int or rule['version'] != 1 or type(rule['revision']) is not int or rule['revision'] < 1:
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
    if type(rule['nearby']) is not bool:
        raise ValueError('nearby must be explicit')
    return rule


def parse(notes):
    if not isinstance(notes, str):
        raise ValueError('Invalid notes')
    # Ordinary user notes are never parsed or warned about.
    if '[hermes-location:' not in notes and '[/hermes-location:' not in notes:
        return None
    if notes.count(START) != 1 or notes.count(END) != 1:
        raise ValueError('Invalid marked rule')
    match = re.search(re.escape(START) + r'\n([^\n]+)\n' + re.escape(END), notes)
    if not match or notes.count('[hermes-location:') != 1 or notes.count('[/hermes-location:') != 1:
        raise ValueError('Invalid marked rule')
    def pairs(items):
        result = {}
        for k, v in items:
            if k in result:
                raise ValueError('Duplicate JSON field')
            result[k] = v
        return result
    return validate(json.loads(match[1], object_pairs_hook=pairs))


def fingerprint(rule):
    return hashlib.sha256(json.dumps(validate(rule), sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def update_notes(notes, rule):
    """Preserve every unrelated byte, including a trailing root #hermes metadata line."""
    validate(rule)
    old = parse(notes)
    readable = f"Lugar: {rule['name']} — {rule['address']}\nMaps: {rule['mapsUrl']}"
    block = START + '\n' + json.dumps(rule, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n' + END
    if old:
        if rule['revision'] <= old['revision']:
            raise ValueError('Revision must increase')
        old_readable = f"Lugar: {old['name']} — {old['address']}\nMaps: {old['mapsUrl']}\n"
        pattern = re.escape(START) + r'\n[^\n]+\n' + re.escape(END)
        if old_readable + START in notes:
            return re.sub(re.escape(old_readable) + pattern, lambda _: readable + '\n' + block, notes, count=1)
        return re.sub(pattern, lambda _: block, notes, count=1)
    # Keep root metadata last; broker views expose it separately as sourceKey.
    lines = notes.splitlines(keepends=True)
    if lines and lines[-1].startswith('#hermes '):
        metadata = lines.pop()
        body = ''.join(lines)
        return body + ('\n' if body and not body.endswith('\n') else '') + readable + '\n' + block + '\n' + metadata
    return notes + ('\n\n' if notes else '') + readable + '\n' + block
