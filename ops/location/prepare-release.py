#!/usr/bin/env python3
"""Prepare a reviewable disabled release in a NEW staging directory, never activate it."""
import argparse
import json
from pathlib import Path
import shutil
import tarfile


def prepare(destination):
    destination = Path(destination).resolve()
    destination.mkdir(mode=0o700)  # Refuse an existing destination.
    root = Path(__file__).resolve().parents[2]
    runtime = destination / 'ops/location'
    runtime.mkdir(parents=True)
    files = ('runner.py', 'state_crypto.py', 'requirements.txt', 'scheduled_cycle.py',
             'presence_runner.py', 'presence_state.py', 'presence-config.example.json',
             'presence-cron-entry.sh', 'PRESENCE-IMPLEMENTATION.md',
             'private_sender.py', 'api_child.py', 'fixture_child.py', 'config.json',
             'cron-entry.sh', 'cron-job.json', 'README.md', 'ACTIVATION.md',
             'google_notes.py', 'notes_state.py', 'notes_runner.py', 'author_notes.py',
             'UNIFIED-IMPLEMENTATION.md', 'notes-config.json', 'notes-cron-entry.sh', 'notes-cron-job.json', 'RELEASE-NOTES.md')
    for name in files:
        shutil.copy2(root / 'ops/location' / name, runtime / name)
    (destination / 'ops/familia').mkdir()
    shutil.copy2(root / 'ops/familia/family_mission.py', destination / 'ops/familia/family_mission.py')
    config = json.loads((destination / 'ops/location/config.json').read_text())
    config['sender'] = '/home/hermes/.hermes/local-customizations/location-runtime/current/ops/location/private_sender.py'
    (destination / 'config.json').write_text(json.dumps(config, indent=2)+'\n')
    (destination / 'config.json').chmod(0o600)
    shutil.copy2(runtime / 'notes-config.json', destination / 'notes-config.json')
    (destination / 'notes-config.json').chmod(0o600)
    # Explicit modes and metadata make the source-only archive reproducible.
    for item in destination.rglob('*'):
        item.chmod(0o700 if item.is_dir() or item.name in ('cron-entry.sh', 'notes-cron-entry.sh', 'presence-cron-entry.sh') else
                   0o600 if item in (destination / 'config.json', destination / 'notes-config.json') else 0o644)
    archive = destination.with_name(destination.name + '.tar')
    with archive.open('xb') as output, tarfile.open(fileobj=output, mode='w') as tar:
        for item in sorted(destination.rglob('*')):
            info = tar.gettarinfo(str(item), arcname=str(item.relative_to(destination)))
            info.uid = info.gid = 0
            info.uname = info.gname = ''
            info.mtime = 0
            if item.is_file():
                with item.open('rb') as source:
                    tar.addfile(info, source)
            else:
                tar.addfile(info)
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('staging_directory', type=Path)
    prepare(parser.parse_args().staging_directory)
