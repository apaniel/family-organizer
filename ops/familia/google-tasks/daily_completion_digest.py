#!/usr/bin/env python3
"""Render a completion digest locally; this script never sends a message."""
import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import family_mission
from scripts import apalas_notification

CHANNELS = {'whatsapp', 'telegram', 'email', 'dashboard', 'other'}


def single_line(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('Invalid completion field.')
    return ' '.join(value.split())


def format_digest(data, expected_date=None, config_path=apalas_notification.DEFAULT_CONFIG):
    """Validate and render the API's {date, explicit, inferred} snapshot.

    Sorting is independent of API ordering. No provenance is inferred locally.
    Malformed/error responses are never rendered as an empty successful digest.
    """
    if not isinstance(data, dict) or 'error' in data or not data.get('date'):
        raise ValueError('Invalid digest response.')
    day = family_mission.digest_date(data['date'])
    if expected_date is not None and day != expected_date:
        raise ValueError('Unexpected digest date.')
    titles = []
    for key in ('explicit', 'inferred'):
        items = data.get(key)
        if not isinstance(items, list):
            raise ValueError('Missing completion section.')
        for item in items:
            if not isinstance(item, dict):
                raise ValueError('Invalid completion.')
            title = single_line(item.get('title'))
            owner = item.get('owner')
            single_line(owner)
            channel = item.get('channel')
            if not isinstance(channel, str) or channel not in CHANNELS:
                raise ValueError('Invalid completion channel.')
            if owner == 'Saida':
                titles.append(title)
    if not titles:
        return ''
    titles.sort(key=lambda title: (title.casefold(), title))
    return apalas_notification.route_notification(
        'Hecho hoy: ' + '; '.join(titles) + '.', config_path)['text']


def main(argv=None, *, fetch_digest=None, stdout=None, stderr=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date', help='Fecha YYYY-MM-DD; por defecto, hoy en Europe/Madrid.')
    parser.add_argument('--config', type=Path, default=apalas_notification.DEFAULT_CONFIG)
    args = parser.parse_args(argv)
    stdout = sys.stdout if stdout is None else stdout
    stderr = sys.stderr if stderr is None else stderr
    try:
        day = family_mission.digest_date(args.date)
        apalas_notification.load_config(args.config)
        data = (fetch_digest or family_mission.completion_digest)(day)
        output = format_digest(data, expected_date=day, config_path=args.config)
    except Exception:
        # Exception bodies may contain server responses or credentials.
        print('Error: no se pudo generar el resumen de tareas.', file=stderr)
        return 1
    if output:
        print(output, file=stdout)
    return 0


if __name__ == '__main__':
    sys.exit(main())
