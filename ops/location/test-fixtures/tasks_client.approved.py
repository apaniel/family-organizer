#!/usr/bin/env python3
"""Family tasks client: python3 client.py ACTION, with a JSON request body on stdin for list/get/create/update/complete/reopen/delete."""
import argparse, http.client, json, socket, sys


class Local(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(120)
        self.sock.connect('/run/hermes-tasks/api.sock')


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('action', choices=['status', 'list', 'get', 'create', 'update', 'complete', 'reopen', 'delete'])
    a = p.parse_args()
    raw = '' if a.action == 'status' or sys.stdin.isatty() else sys.stdin.read().strip()
    data = json.loads(raw) if raw else {}
    data['action'] = a.action
    c = Local('localhost')
    c.request('POST', '/v1', json.dumps(data), {'Content-Type': 'application/json'})
    r = c.getresponse()
    print(r.read().decode())
    sys.exit(0 if r.status == 200 else 1)
