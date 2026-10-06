"""Private, locked, atomic JSON ledger. Missing/corrupt state never means fresh state."""
import hashlib
import re
import fcntl
import json
import math
import os
import stat
import uuid
from pathlib import Path

FIELDS = {'listId', 'id', 'fingerprint', 'phase', 'lastfix', 'delivery', 'attempts', 'episode'}
STATUSES = {'idle', 'retry', 'unknown', 'sent', 'failed', 'stopped'}


def validate(data):
    if not isinstance(data, dict) or set(data) != {'version', 'items'} or type(data['version']) is not int or data['version'] != 1 or not isinstance(data['items'], dict):
        raise ValueError('Invalid ledger')
    for key, item in data['items'].items():
        if not isinstance(key, str) or not re.fullmatch('[0-9a-f]{64}', key) or not isinstance(item, dict) or not FIELDS <= set(item) or set(item) - FIELDS - {'outside_at', 'message', 'notice_version'}:
            raise ValueError('Invalid ledger item')
        if any(not isinstance(item[k], str) or not item[k] for k in ('listId', 'id', 'fingerprint')) or not re.fullmatch('[0-9a-f]{64}', item['fingerprint']):
            raise ValueError('Invalid ledger identity')
        expected = hashlib.sha256(json.dumps(['Dani', item['listId'], item['id']], separators=(',', ':')).encode()).hexdigest()
        if key != expected:
            raise ValueError('Invalid canonical ledger identity')
        if item['phase'] not in (None, 'outside', 'inside') or item['delivery'] not in STATUSES:
            raise ValueError('Invalid ledger status')
        if 'message' in item or 'notice_version' in item:
            if (not isinstance(item.get('message'), str) or not 1 <= len(item['message']) <= 2000
                    or item.get('notice_version') != 1 or item['episode'] != 1):
                raise ValueError('Invalid immutable notice')
        if 'outside_at' in item and (type(item['outside_at']) not in (int, float) or not math.isfinite(item['outside_at']) or not 0 <= item['outside_at'] <= item['lastfix']):
            raise ValueError('Invalid outside evidence')
        if type(item['lastfix']) not in (int, float) or not math.isfinite(item['lastfix']) or item['lastfix'] < 0:
            raise ValueError('Invalid fix timestamp')
        if type(item['attempts']) is not int or not 0 <= item['attempts'] <= 3 or type(item['episode']) is not int or item['episode'] not in (0, 1):
            raise ValueError('Invalid ledger counters')
        if item['delivery'] in ('retry', 'unknown', 'sent', 'failed') and (item['episode'] != 1 or item['delivery'] != 'retry' and item['attempts'] < 1):
            raise ValueError('Invalid delivery evidence')
        if item['delivery'] == 'idle' and (item['episode'] != 0 or item['attempts'] != 0):
            raise ValueError('Invalid idle evidence')
    return data


def unique(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError('Duplicate ledger field')
        result[key] = value
    return result


class State:
    validator = staticmethod(validate)
    initial = {"version": 1, "items": {}}

    def __init__(self, filename, initialize=False):
        path = Path(filename)
        if not path.is_absolute() or path.name in ('', '.', '..') or '..' in path.parts:
            raise ValueError('Absolute private ledger required')
        self.directory = None
        self.lock = None
        self.name = path.name
        try:
            fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
            try:
                for part in path.parent.parts[1:]:
                    child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                    os.close(fd)
                    fd = child
                self.directory = fd
            except BaseException:
                os.close(fd)
                raise
            info = os.fstat(fd)
            if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
                raise ValueError('Ledger directory must be owned mode 0700')
            self.lock = os.open(self.name + '.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=fd)
            self.check(self.lock)
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if initialize:
                output = os.open(self.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
                try:
                    os.write(output, (json.dumps(self.initial)+'\n').encode())
                    os.fsync(output)
                finally:
                    os.close(output)
                os.fsync(fd)
            source = os.open(self.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
            try:
                self.check(source)
                with os.fdopen(source, 'r', closefd=False) as stream:
                    self.data = self.validator(json.load(stream, object_pairs_hook=unique))
            finally:
                os.close(source)
        except BaseException:
            self.close()
            raise

    @staticmethod
    def check(fd):
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1:
            raise ValueError('Ledger file must be owned regular mode 0600')

    def save(self):
        self.validator(self.data)
        # Refuse an externally replaced unsafe target as well as unsafe input.
        old = os.open(self.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=self.directory)
        try:
            self.check(old)
        finally:
            os.close(old)
        temporary = self.name + '.' + uuid.uuid4().hex
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=self.directory)
        try:
            with os.fdopen(fd, 'w', closefd=False) as stream:
                json.dump(self.data, stream, sort_keys=True, separators=(',', ':'))
                stream.write('\n')
                stream.flush()
                os.fsync(fd)
            os.replace(temporary, self.name, src_dir_fd=self.directory, dst_dir_fd=self.directory)
            os.fsync(self.directory)
        finally:
            os.close(fd)
            try:
                os.unlink(temporary, dir_fd=self.directory)
            except FileNotFoundError:
                pass

    def close(self):
        for attr in ('lock', 'directory'):
            fd = getattr(self, attr, None)
            if fd is not None:
                os.close(fd)
                setattr(self, attr, None)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
