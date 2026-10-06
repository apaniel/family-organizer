import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('install_main', Path(__file__).with_name('install-main.py'))
INSTALL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALL)


class InstallTests(unittest.TestCase):
    @patch('sys.dont_write_bytecode', True)
    @patch.dict(os.environ, {'PYTHONDONTWRITEBYTECODE': '1'})
    def test_clean_main_private_install_preserves_state_and_executes_disabled_entry(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            repo = root/'repo'; repo.mkdir()
            shutil.copytree(Path(__file__).parent, repo/'ops/location', ignore=shutil.ignore_patterns('__pycache__'))
            (repo/'ops/familia').mkdir()
            (repo/'ops/familia/family_mission.py').write_text('# offline fixture\n')
            def git(*args):
                return subprocess.check_output(['git', '-C', str(repo), *args], text=True, stderr=subprocess.DEVNULL).strip()
            git('init', '-b', 'main'); git('add', '.')
            git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture')
            commit = git('rev-parse', 'HEAD')
            home = root/'private'; home.mkdir(mode=0o700)
            release = INSTALL.install(repo, home, commit)
            for directory in (home/'state', home/'local-customizations', home/'state/location-notes'):
                self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
            config = home/'state/location-notes/config.json'
            state = config.with_name('state.json')
            original = state.read_bytes()
            self.assertFalse(json.loads(config.read_text())['enabled'])
            self.assertEqual(config.stat().st_mode & 0o777, 0o600)
            self.assertEqual(state.stat().st_mode & 0o777, 0o600)
            self.assertEqual((home/'local-customizations/location-runtime/current').resolve(), release)
            # Execute the actual installed shell; fixture supplies only the interpreter.
            python = home/'hermes-agent/venv/bin/python'; python.parent.mkdir(parents=True)
            python.symlink_to(os.sys.executable)
            entry = home/'scripts/location-google-notes.sh'
            subprocess.run(['bash', str(entry)], check=True, capture_output=True)
            presence_config = home/'state/location-presence/config.json'
            presence_state = presence_config.with_name('state.json')
            presence_bytes = presence_state.read_bytes()
            presence_config_bytes = presence_config.read_bytes()
            self.assertFalse(json.loads(presence_config_bytes)['enabled'])
            self.assertEqual(json.loads(presence_bytes), {'version': 1, 'claim': None})
            result = subprocess.run(['bash', str(home/'scripts/location-presence-once.sh')], check=True, capture_output=True, text=True)
            self.assertIn('presencia está desactivada', result.stdout)
            saved_config = config.read_bytes()
            INSTALL.install(repo, home, commit)
            self.assertEqual(config.read_bytes(), saved_config)
            self.assertEqual(state.read_bytes(), original)
            self.assertEqual(presence_config.read_bytes(), presence_config_bytes)
            self.assertEqual(presence_state.read_bytes(), presence_bytes)
            (repo/'ops/location/README.md').write_text('Reviewed fixture upgrade\n')
            git('add', '.')
            git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'upgrade')
            newer = git('rev-parse', 'HEAD')
            updated = INSTALL.install(repo, home, newer)
            self.assertTrue(release.exists())
            self.assertEqual((home/'local-customizations/location-runtime/current').resolve(), updated)
            self.assertEqual(config.read_bytes(), saved_config)
            self.assertEqual(state.read_bytes(), original)
            # Roll back only source pointer through the same exact-main installer.
            git('reset', '--hard', commit)
            INSTALL.install(repo, home, commit)
            self.assertEqual((home/'local-customizations/location-runtime/current').resolve(), release)
            self.assertTrue(updated.exists())
            self.assertEqual(entry.stat().st_mode & 0o777, 0o700)
            git('checkout', '-b', 'feature')
            with self.assertRaises(ValueError): INSTALL.install(repo, home, commit)
            git('checkout', 'main')
            (repo/'dirty').write_text('dirty')
            with self.assertRaises(ValueError): INSTALL.install(repo, home, commit)
            self.assertEqual(state.read_bytes(), original)
