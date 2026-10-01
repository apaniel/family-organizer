import unittest
from unittest.mock import patch
import worker

TASK = dict(id='google-id', revision=123, kind='task', title='Disposable', notes='', date='2026-10-01', status='open', owner='Familia', category='family', reminderDays=0, time='')

class RelayTests(unittest.TestCase):
    def test_stale_revision_never_writes(self):
        with patch.object(worker.family_tasks, 'save') as save:
            with self.assertRaises(ValueError):
                worker.execute({'action':'save','record':{**TASK,'revision':1}},[TASK])
            save.assert_not_called()

    def test_create_update_complete_verified_by_google_readback(self):
        for changes in ({'id':'','title':'Created'},{'title':'Updated'},{'status':'done'}):
            record={**TASK,**changes}
            saved={**record,'id':'google-id','revision':124}
            with patch.object(worker.family_tasks,'save',return_value={'record':saved}) as save, patch.object(worker,'snapshot',return_value=[saved]):
                result,after=worker.execute({'action':'save','record':record,'sourceKey':'stable'},[TASK])
                self.assertEqual(result['record'],saved)
                if not record['id']:
                    self.assertEqual(save.call_args.args[0]['sourceKey'],'stable')

    def test_source_notes_and_unassigned_owner_readback(self):
        record={**TASK,'id':'','source':'Familia','owner':'Sin asignar','sourceKey':'intent'}
        saved={**TASK,'notes':'Origen: Familia','owner':'Sin asignar'}
        with patch.object(worker.family_tasks,'save',return_value={'record':saved}),patch.object(worker,'snapshot',return_value=[saved]):
            result,_=worker.execute({'action':'save','record':record,'sourceKey':'intent'},[])
            self.assertEqual(result['record'],saved)
        fields=worker.family_tasks.to_fields(record,creating=True)
        self.assertEqual(fields['owner'],'Familia')
        self.assertTrue(fields['notes'].endswith(worker.family_tasks.UNASSIGNED_NOTE))

    def test_delete_requires_absence_in_google(self):
        with patch.object(worker.family_tasks,'delete'),patch.object(worker,'snapshot',return_value=[TASK]):
            with self.assertRaises(RuntimeError):worker.execute({'action':'delete','record':TASK},[TASK])
        with patch.object(worker.family_tasks,'delete'),patch.object(worker,'snapshot',return_value=[]):
            self.assertEqual(worker.execute({'action':'delete','record':TASK},[TASK]),({'ok':True},[]))

    def test_mismatched_readback_is_never_success(self):
        with patch.object(worker.family_tasks,'save',return_value={'record':TASK}),patch.object(worker,'snapshot',return_value=[TASK]):
            with self.assertRaises(RuntimeError):worker.execute({'action':'save','record':{**TASK,'title':'Changed'}},[TASK])

    def test_ambiguous_broker_failure_is_acknowledged_without_retry(self):
        command={'id':'operation','leaseToken':'lease','payload':{'action':'save','record':TASK}}
        with patch.object(worker,'relay',side_effect=[{'command':command},{'ok':True},{'ok':True}]) as relay,patch.object(worker,'snapshot',return_value=[TASK]),patch.object(worker,'execute',side_effect=RuntimeError('uncertain')) as execute:
            worker.tick()
            self.assertEqual(execute.call_count,1)
            self.assertEqual(relay.call_args.args[0]['state'],'ambiguous')

    def test_preflight_conflict_is_explicit_and_never_writes(self):
        command={'id':'operation','leaseToken':'lease','payload':{'action':'save','record':{**TASK,'revision':1}}}
        with patch.object(worker,'relay',side_effect=[{'command':command},{'ok':True},{'ok':True}]) as relay,patch.object(worker,'snapshot',return_value=[TASK]),patch.object(worker.family_tasks,'save') as save:
            worker.tick()
            save.assert_not_called()
            self.assertEqual(relay.call_args.args[0]['state'],'failed')

    def test_no_command_only_refreshes_google_mirror(self):
        with patch.object(worker,'relay',side_effect=[{'command':None},{'generation':7},{'ok':True}]) as relay,patch.object(worker,'snapshot',return_value=[TASK]),patch.object(worker,'execute') as execute:
            worker.tick()
            execute.assert_not_called()
            self.assertEqual(relay.call_args.args[0],{'action':'snapshot','generation':7,'records':[TASK]})

if __name__=='__main__':unittest.main()
