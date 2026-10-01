"""Canonical source and identity contracts for the local family adapter."""
import contextlib
import io
import json
import os
import unittest
from unittest.mock import patch
import family_mission
import family_tasks


class CanonicalTests(unittest.TestCase):
    def test_identity_status_and_digest_follow_google_not_d1(self):
        task = dict(id='google-id', title='Disposable', due='2026-10-01', time=None,
                    owner='Familia', done=True, waiting=True, category=None, notes='',
                    reminderDays=0, sourceKey='original:key', updated='2026-10-01T10:00:00Z',
                    completed='2026-10-01T10:00:00Z', eventId=None, webViewLink=None)
        with patch.object(family_tasks, 'broker', return_value={'tasks': [task]}), patch.object(family_mission, 'request', return_value={'records': [{'kind': 'task', 'id': 'stale', 'status': 'open'}, {'kind': 'meal', 'id': 'meal'}]}):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                family_mission.main(['list'])
            records = json.loads(output.getvalue())['records']
            self.assertEqual([r['id'] for r in records], ['google-id', 'meal'])
            self.assertEqual((records[0]['status'], records[0]['sourceKey']), ('done', 'original:key'))
            digest = family_mission.completion_digest('2026-10-01')
            self.assertEqual(digest['explicit'], [])
            self.assertEqual(digest['inferred'][0]['id'], 'google-id')
            self.assertEqual(digest['inferred'][0]['channel'], 'other')

    def test_unassigned_roundtrips_through_shared_list_and_explicit_note(self):
        original=dict(id='disposable', title='Disposable', due='', time=None, owner='Familia',done=False,waiting=False,category='family',notes='',reminderDays=0,sourceKey='intent',updated='now',completed=None,eventId=None,webViewLink=None)
        fields=family_tasks.to_fields({'title':'Disposable','notes':'Original','source':'Familia','sourceKey':'intent','owner':'Sin asignar'},creating=True)
        self.assertEqual(fields['owner'],'Familia')
        self.assertEqual(fields['notes'],'Original\nOrigen: Familia\nResponsable (Dashboard): Sin asignar')
        saved=family_tasks.to_record({**original,**fields})
        self.assertEqual(saved['owner'],'Sin asignar')
        self.assertEqual(saved['notes'],'Original\nOrigen: Familia')
        assigned=family_tasks.to_fields({**saved,'owner':'Dani'},creating=False)
        self.assertNotIn(family_tasks.UNASSIGNED_NOTE,assigned['notes'])
        self.assertEqual(assigned['owner'],'Dani')
        self.assertEqual(family_tasks.to_record(original)['owner'],'Familia')

    def test_writes_keep_identity_and_reject_wrong_profile_and_local_events(self):
        with patch.object(family_tasks, 'broker', return_value={'task': {}}) as broker, patch.object(family_tasks, 'to_record', side_effect=lambda r: r):
            family_tasks.save({'id': 'google-id', 'status': 'done', 'sourceKey': 'original:key'})
            broker.assert_called_once_with('update', {'id': 'google-id', 'task': {'done': True, 'waiting': False}})
        with patch.dict(os.environ, {'HERMES_HOME': '/different-profile'}), patch.object(family_tasks.subprocess, 'run') as run:
            with self.assertRaises(ValueError):
                family_tasks.list_tasks()
            run.assert_not_called()
        with patch.object(family_mission.sys, 'stdin', io.StringIO('{"kind":"event","title":"Duplicate"}')), patch.object(family_mission, 'request') as request:
            with self.assertRaises(ValueError):
                family_mission.main(['save'])
            request.assert_not_called()


if __name__ == '__main__':
    unittest.main()
