"""Local per-database Fernet key; legacy databases deliberately fail closed."""
import fcntl
import os
import sqlite3
import stat
from pathlib import Path
from cryptography.fernet import Fernet


def private_stat(s):
    if not stat.S_ISREG(s.st_mode) or s.st_uid != os.getuid() or stat.S_IMODE(s.st_mode) != 0o600 or s.st_nlink != 1:
        raise ValueError('State file ownership/mode/type invalid')


def private_directory(path):
    """Walk without following components; retain a descriptor for the private parent.

    Ancestors may have normal home/root modes. The immediate parent must already
    be private and owned by us. Other users cannot replace entries within it;
    malicious same-uid processes are outside this boundary (they can read the key).
    Linux descriptor paths anchor validation and SQLite setup. SQLite can resolve
    them to canonical names, so ancestors must also exclude untrusted renames.
    Root and same-uid mutation are outside this boundary.
    """
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    protected = False
    try:
        for component in path.parts[1:]:
            try:
                child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            except FileNotFoundError:
                try:
                    os.mkdir(component, 0o700, dir_fd=fd)
                except FileExistsError:
                    pass
                child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
            ancestor = os.fstat(fd)
            if ancestor.st_uid not in (0, os.getuid()):
                raise ValueError('State ancestor ownership invalid')
            if not protected and ancestor.st_mode & 0o022 and not ancestor.st_mode & stat.S_ISVTX:
                raise ValueError('State ancestor permits untrusted rename')
            if ancestor.st_uid == os.getuid() and not ancestor.st_mode & 0o077:
                protected = True
        s = os.fstat(fd)
        if s.st_uid != os.getuid() or stat.S_IMODE(s.st_mode) != 0o700:
            raise ValueError('State directory ownership/mode invalid')
        return fd
    except BaseException:
        os.close(fd)
        raise


def checked_file(directory, name, optional=False):
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    except FileNotFoundError:
        if optional:
            return None
        raise
    try:
        private_stat(os.fstat(fd))
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            return stream.read() if name.endswith('.key') else True
    finally:
        os.close(fd)


class AnchoredConnection(sqlite3.Connection):
    directory_fd = None

    def close(self):
        try:
            super().close()
        finally:
            if self.directory_fd is not None:
                os.close(self.directory_fd)
                self.directory_fd = None


def open_state(path):
    if '..' in Path(path).parts:
        raise ValueError('State path traversal invalid')
    path = Path(os.path.abspath(path))
    directory = private_directory(path.parent)
    fd = None
    try:
        fd = os.open(path.name + '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=directory)
        private_stat(os.fstat(fd))
        fcntl.flock(fd, fcntl.LOCK_EX)
        # Validate every existing entry before even the read-only SQLite probe.
        exists = checked_file(directory, path.name, optional=True)
        key = checked_file(directory, path.name + '.key', optional=True)
        sidecars = [checked_file(directory, path.name + suffix, optional=True)
                    for suffix in ('-wal', '-shm', '-journal')]
        anchored = Path('/proc/self/fd') / str(directory) / path.name
        if exists:
            probe = sqlite3.connect(anchored.as_uri() + '?mode=ro', uri=True)
            try:
                marker = probe.execute('SELECT token FROM state_security WHERE version=1').fetchone()
                if not marker:
                    raise ValueError('State security marker missing')
            finally:
                probe.close()
            if key is None:
                raise ValueError('State key missing')
            cipher = Fernet(key)
            if cipher.decrypt(marker[0]) != b'location-state-v1':
                raise ValueError('State key invalid')
        else:
            if any(sidecars):
                raise ValueError('Orphaned state journal')
            if key is None:
                key = Fernet.generate_key()
                key_fd = os.open(path.name + '.key', os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=directory)
                with os.fdopen(key_fd, 'wb') as stream:
                    stream.write(key); stream.flush(); os.fsync(stream.fileno())
                os.fsync(directory)
            cipher = Fernet(key)
            db_fd = os.open(path.name, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=directory)
            os.close(db_fd)
        db = sqlite3.connect(anchored, timeout=10, isolation_level=None, factory=AnchoredConnection)
        try:
            if not exists:
                db.execute('CREATE TABLE state_security(version INTEGER PRIMARY KEY, token BLOB NOT NULL)')
                db.execute('INSERT INTO state_security VALUES(1,?)', (cipher.encrypt(b'location-state-v1'),))
            if db.execute("SELECT 1 FROM sqlite_master WHERE name='deliveries'").fetchone():
                for key, token in db.execute('SELECT key,message FROM deliveries'):
                    decode(cipher, key, token)
            db.directory_fd = directory
            directory = None
            return db, cipher
        except BaseException:
            db.close(); raise
    finally:
        if fd is not None:
            os.close(fd)
        if directory is not None:
            os.close(directory)


def encode(cipher, key, message):
    import json
    return cipher.encrypt(json.dumps([key, message], ensure_ascii=False).encode())


def decode(cipher, key, token):
    import json
    stored_key, message = json.loads(cipher.decrypt(token))
    if stored_key != key or not isinstance(message, str):
        raise ValueError('State payload identity invalid')
    return message
