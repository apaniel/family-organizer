#!/usr/bin/env python3
"""HermesClaw health + location reader: python3 client.py SUBCOMMAND [PERSON] [options]. Prints JSON.

Talks to the root-owned read-only broker; the agent has no token.
"""
import argparse, http.client, json, socket, sys

SOCKET = '/run/hermes-health/api.sock'

ALIASES = {
    'steps': 'HKQuantityTypeIdentifierStepCount',
    'heart_rate': 'HKQuantityTypeIdentifierHeartRate',
    'hr': 'HKQuantityTypeIdentifierHeartRate',
    'resting_hr': 'HKQuantityTypeIdentifierRestingHeartRate',
    'hrv': 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
    'active_energy': 'HKQuantityTypeIdentifierActiveEnergyBurned',
    'distance': 'HKQuantityTypeIdentifierDistanceWalkingRunning',
    'flights': 'HKQuantityTypeIdentifierFlightsClimbed',
    'exercise': 'HKQuantityTypeIdentifierAppleExerciseTime',
    'weight': 'HKQuantityTypeIdentifierBodyMass',
    'spo2': 'HKQuantityTypeIdentifierOxygenSaturation',
    'respiratory_rate': 'HKQuantityTypeIdentifierRespiratoryRate',
    'vo2max': 'HKQuantityTypeIdentifierVO2Max',
    'sleep': 'HKCategoryTypeIdentifierSleepAnalysis',
    'workout': 'HKWorkoutTypeIdentifier',
}


def fail(msg, code=1):
    print(json.dumps({'ok': False, 'error': msg}))
    sys.exit(code)


class UnixHTTPConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(SOCKET)


def get(action, params):
    body = json.dumps({'action': action, **{k: v for k, v in params.items() if v is not None}})
    connection = UnixHTTPConnection('localhost', timeout=45)
    try:
        connection.request('POST', '/v1', body=body, headers={
            'Content-Type': 'application/json',
            'User-Agent': 'hermes-health-client/1',
        })
        response = connection.getresponse()
        if response.status >= 400:
            body = response.read().decode(errors='replace')
            print(body if body.startswith('{') else json.dumps({'ok': False, 'status': response.status, 'error': body[:300]}))
            sys.exit(1)
        return response.read().decode()
    except (OSError, http.client.HTTPException) as e:
        fail(f'network error: {e}')
    finally:
        connection.close()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='cmd', required=True)
    sub.add_parser('persons', help='people, devices, last upload/location times')

    def person_cmd(name, help_):
        sp = sub.add_parser(name, help=help_)
        sp.add_argument('person', help='dan or wife')
        sp.add_argument('--tz', help='IANA timezone for day boundaries (default: phone tz)')
        return sp

    person_cmd('where', 'latest known location and last visit')
    sp = person_cmd('locations', 'location history')
    for a in ('--from', '--to', '--kind', '--limit', '--order'):
        sp.add_argument(a)
    person_cmd('types', 'health types with counts and latest timestamp')
    sp = person_cmd('health', 'raw health samples')
    for a in ('--type', '--from', '--to', '--kind', '--limit', '--order'):
        sp.add_argument(a)
    sp = person_cmd('daily', 'per-day aggregate of one type')
    sp.add_argument('--type', required=True)
    for a in ('--from', '--to', '--agg'):
        sp.add_argument(a)
    sp = person_cmd('summary', 'compact day digest (activity, vitals, sleep, workouts, places)')
    sp.add_argument('--date', help='YYYY-MM-DD (default today)')

    a = vars(p.parse_args())
    cmd = a.pop('cmd')
    if a.get('type'):
        a['type'] = ALIASES.get(a['type'], a['type'])
    routes = {
        'persons': 'persons', 'where': 'location_latest', 'locations': 'location',
        'types': 'health_types', 'health': 'health', 'daily': 'health_daily', 'summary': 'summary',
    }
    print(get(routes[cmd], a))


if __name__ == '__main__':
    main()
