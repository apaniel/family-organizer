#!/usr/bin/env python3
"""Parent-reviewed local installation from an exact clean checked-out main commit."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import stat
import tempfile


def install(repo, home, commit):
    repo, home = Path(repo).resolve(), Path(home).absolute()
    def git(*args):
        return subprocess.check_output(['git', '-C', str(repo), *args], text=True).strip()
    if git('branch', '--show-current') != 'main' or git('rev-parse', 'HEAD') != commit or git('status', '--porcelain'):
        raise ValueError('Exact clean checked-out main commit required')
    # The caller supplies the reviewed commit; this script never fetches/merges.
    if not home.is_absolute() or '..' in home.parts:
        raise ValueError('Absolute private home required')
    for ancestor in (home, *home.parents):
        if ancestor.is_symlink():
            raise ValueError('Symlink home ancestor rejected')
    base = home/'local-customizations/location-runtime'
    scripts = home/'scripts'
    private = home/'state/location-notes'
    for directory in (base, scripts, private):
        for ancestor in (directory, *directory.parents):
            if ancestor.is_symlink():
                raise ValueError('Symlink install ancestor rejected')
        cursor = home
        for part in directory.relative_to(home).parts:
            cursor = cursor/part
            cursor.mkdir(mode=0o700, exist_ok=True)
        if directory.is_symlink() or directory.stat().st_uid != os.getuid() or directory.stat().st_mode & 0o777 != 0o700:
            raise ValueError('Private owned 0700 directory required')
    release = base/('release-'+commit)
    if release.is_symlink():
        raise ValueError('Symlink release rejected')
    spec = importlib.util.spec_from_file_location('release_prepare', repo/'ops/location/prepare-release.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    with tempfile.TemporaryDirectory(dir=base) as temp:
        staged = module.prepare(Path(temp)/'source')
        if release.exists():
            expected = {str(p.relative_to(staged)): p.read_bytes() for p in staged.rglob('*') if p.is_file()}
            actual = {str(p.relative_to(release)): p.read_bytes() for p in release.rglob('*') if p.is_file()}
            if actual != expected:
                raise ValueError('Existing version differs; preserve it for review')
        else:
            os.rename(staged, release)
    config = private/'config.json'
    if not config.exists():
        data = json.loads((release/'notes-config.json').read_text())
        data.update(state=str(private/'state.json'), sender=str(base/'current/ops/location/private_sender.py'))
        with config.open('x') as output:
            os.fchmod(output.fileno(), 0o600); output.write(json.dumps(data, indent=2)+'\n')
    if config.is_symlink() or not stat.S_ISREG(config.stat().st_mode) or config.stat().st_uid != os.getuid() or config.stat().st_nlink != 1 or config.stat().st_mode & 0o777 != 0o600:
        raise ValueError('Private regular 0600 config required')
    data = json.loads(config.read_text())
    # Existing state and configs are never overwritten or reinitialized.
    if not (private/'state.json').exists():
        if data.get('enabled') is not False or data.get('state') != str(private/'state.json'):
            raise ValueError('Disabled new config required')
        subprocess.run([os.sys.executable, str(release/'ops/location/notes_runner.py'), '--config', str(config), '--initialize-state', '--quiet'], check=True)
    if (base/'current').exists() and not (base/'current').is_symlink():
        raise ValueError('Existing current must be a symlink')
    entry = scripts/'location-google-notes.sh'
    text = (release/'ops/location/notes-cron-entry.sh').read_text().replace('/home/hermes/.hermes', str(home))
    pending = scripts/'.location-google-notes.new'
    with pending.open('x') as output:
        os.fchmod(output.fileno(), 0o700); output.write(text)
    os.replace(pending, entry)
    pending = base/'.current.new'
    if pending.exists() or pending.is_symlink():
        pending.unlink()
    pending.symlink_to(release.name)
    os.replace(pending, base/'current')
    return release


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo', type=Path, required=True)
    p.add_argument('--commit', required=True)
    p.add_argument('--home', type=Path, default=Path('/home/hermes/.hermes'))
    a = p.parse_args()
    install(a.repo, a.home, a.commit)
