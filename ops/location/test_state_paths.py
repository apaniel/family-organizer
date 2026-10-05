"""Adversarial synthetic paths: SQLite must not open unsafe existing entries."""
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from runner import Engine
import state_crypto


class StatePathTests(unittest.TestCase):
    def test_ancestor_symlink_reviewer_reproduction(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root/'real').mkdir()
            (root/'alias').symlink_to(root/'real', target_is_directory=True)
            with patch.object(state_crypto.sqlite3, 'connect', side_effect=AssertionError('SQLite opened')):
                with self.assertRaises(OSError):
                    Engine(root/'alias'/'private'/'state')
            self.assertFalse((root/'real/private').exists())
            with self.assertRaises(ValueError):
                Engine(root/'alias/../private/state')

    def test_normal_ancestor_modes_and_private_parent_required(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); root.chmod(0o755)
            e = Engine(root/'private/state'); e.close()
            self.assertEqual(root.stat().st_mode & 0o777, 0o755)
            with self.assertRaises(ValueError):
                Engine(root/'state')
            self.assertEqual(root.stat().st_mode & 0o777, 0o755)

    def test_unprotected_writable_ancestor_rejected_without_chmod(self):
        # /tmp is trusted root-owned sticky; a nonsticky writable child is not.
        with tempfile.TemporaryDirectory(dir='/tmp') as d:
            root = Path(d); root.chmod(0o777)
            with self.assertRaises(ValueError):
                Engine(root/'private/state')
            self.assertEqual(root.stat().st_mode & 0o777, 0o777)
            self.assertFalse((root/'private').exists())

    def test_all_existing_entries_rejected_before_sqlite(self):
        for suffix in ('', '.key', '.lock', '-wal', '-shm', '-journal'):
            for fault in ('mode', 'symlink', 'fifo', 'directory', 'owner'):
                with self.subTest(suffix=suffix, fault=fault), tempfile.TemporaryDirectory() as d:
                    path = Path(d)/'state'; e = Engine(path); e.close()
                    item = Path(str(path)+suffix)
                    if not item.exists():
                        item.touch(mode=0o600)
                    if fault == 'mode':
                        item.chmod(0o644)
                    elif fault == 'owner':
                        if os.geteuid() != 0:
                            # Simulate foreign uid at the fstat boundary; no chown privilege.
                            original = state_crypto.os.fstat
                            inode = item.stat().st_ino
                            def foreign(fd):
                                s = original(fd)
                                if s.st_ino == inode:
                                    fields = list(s); fields[4] = os.getuid()+1
                                    return os.stat_result(fields)
                                return s
                        else:
                            os.chown(item, 1, -1)
                            foreign = os.fstat
                    else:
                        item.unlink()
                        if fault == 'symlink':
                            target = Path(d)/'target'; target.write_bytes(b'untouched'); target.chmod(0o600)
                            item.symlink_to(target)
                        elif fault == 'fifo':
                            os.mkfifo(item, 0o600)
                        else:
                            item.mkdir(mode=0o700)
                    with patch.object(state_crypto.sqlite3, 'connect', side_effect=AssertionError('SQLite opened')):
                        if fault == 'owner':
                            with patch.object(state_crypto.os, 'fstat', side_effect=foreign):
                                with self.assertRaises((ValueError, OSError)):
                                    Engine(path)
                        else:
                            with self.assertRaises((ValueError, OSError)):
                                Engine(path)
                    if fault == 'symlink':
                        self.assertEqual(target.read_bytes(), b'untouched')

    def test_existing_live_wal_reviewer_reproduction(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)/'state'; e = Engine(path)
            try:
                wal = Path(str(path)+'-wal'); wal.chmod(0o644)
                with patch.object(state_crypto.sqlite3, 'connect', side_effect=AssertionError('SQLite opened')):
                    with self.assertRaises(ValueError):
                        Engine(path)
            finally:
                e.close()

    def test_directory_rename_between_validation_and_sqlite_is_anchored(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); parent = root/'private'; path = parent/'state'
            e = Engine(path); e.close()
            connect = sqlite3.connect
            calls = []
            def rename_then_connect(*args, **kwargs):
                if not calls:
                    parent.rename(root/'pinned')
                    parent.symlink_to(root/'decoy', target_is_directory=True)
                    (root/'decoy').mkdir()
                calls.append(str(args[0]))
                return connect(*args, **kwargs)
            with patch.object(state_crypto.sqlite3, 'connect', side_effect=rename_then_connect):
                e = Engine(path)
            e.db.execute("INSERT INTO cache VALUES('pinned',1,'{}')")
            e.close()
            self.assertTrue(all('/proc/self/fd/' in call for call in calls))
            self.assertEqual(list((root/'decoy').iterdir()), [])
            db = connect(root/'pinned/state')
            self.assertEqual(db.execute('SELECT key FROM cache').fetchone(), ('pinned',)); db.close()
