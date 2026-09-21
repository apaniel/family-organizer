import unittest
from unittest.mock import patch
import worker
from worker import process_messages


class WorkerTests(unittest.TestCase):
    def test_starts_oldest_queued_message_for_each_parent(self):
        calls, updates = [], []
        messages=[{'id':'q1','person':'Dani','conversationId':'c1','text':'Hazlo','status':'queued','files':[],'created':1}]
        process_messages(messages,lambda path,body=None,key=None:calls.append((path,body,key)) or {'run_id':'run_1'},updates.append,lambda _:[])
        self.assertEqual(calls[0][0],'runs')
        self.assertEqual(updates,[{'id':'q1','status':'pending','run':'run_1'}])

    def test_steers_the_active_run_without_starting_another(self):
        calls, updates = [], []
        messages=[{'id':'p1','person':'Cris','conversationId':'c1','text':'Primero','status':'pending','run':'run_1','files':[],'created':1},{'id':'s1','person':'Cris','conversationId':'c1','text':'Cámbialo','status':'steer_pending','files':[],'created':2}]
        def api(path,body=None,key=None):
            calls.append((path,body,key))
            if path=='runs/run_1':return {'status':'running'}
            return {'accepted':True}
        process_messages(messages,api,updates.append,lambda _:[])
        self.assertIn(('runs/run_1/steer',{'input':'Cámbialo'},None),calls)
        self.assertIn({'id':'s1','status':'steered','answer':'Añadido a la tarea en curso.'},updates)

    def test_completes_a_run_and_then_starts_its_queue(self):
        calls, updates = [], []
        messages=[{'id':'p1','person':'Dani','conversationId':'c1','text':'Primero','status':'pending','run':'run_1','files':[],'created':1},{'id':'q1','person':'Dani','conversationId':'c1','text':'Después','status':'queued','files':[],'created':2}]
        def api(path,body=None,key=None):
            calls.append((path,body,key))
            return {'status':'completed','output':'Hecho'} if path=='runs/run_1' else {'run_id':'run_2'}
        process_messages(messages,api,updates.append,lambda _:[])
        self.assertIn({'id':'p1','status':'completed','answer':'Hecho'},updates)
        self.assertIn({'id':'q1','status':'pending','run':'run_2'},updates)

    def test_different_conversations_can_run_independently(self):
        calls,updates=[],[]
        messages=[{'id':'a','person':'Dani','conversationId':'c1','text':'Uno','status':'queued','files':[],'created':1},{'id':'b','person':'Dani','conversationId':'c2','text':'Dos','status':'queued','files':[],'created':2}]
        process_messages(messages,lambda path,body=None,key=None:calls.append((path,body,key)) or {'run_id':'run_'+str(key)[-1]},updates.append,lambda _:[])
        self.assertEqual(len([call for call in calls if call[0]=='runs']),2)
        self.assertEqual({call[1]['session_id'] for call in calls},{'apalas-dashboard-dani-c1','apalas-dashboard-dani-c2'})

    def test_external_conversation_targets_its_own_environment(self):
        calls=[]
        messages=[{'id':'a','person':'Dani','conversationId':'finenance-c1','text':'Cambia el botón','status':'queued','files':[],'created':1},{'id':'b','person':'Dani','conversationId':'allianz-c2','text':'Cambia la cabecera','status':'queued','files':[],'created':2}]
        process_messages(messages,lambda path,body=None,key=None:calls.append((path,body,key)) or {'run_id':'run_'+str(key)[-1]},lambda _:None,lambda _:[])
        run_bodies=[call[1] for call in calls if call[0]=='runs']
        self.assertIn('/home/hermes/workspaces/finenance',run_bodies[0]['instructions'])
        self.assertIn('FineNance',run_bodies[0]['instructions'])
        self.assertIn('/home/hermes/workspaces/allianz',run_bodies[1]['instructions'])
        self.assertIn('Allianz',run_bodies[1]['instructions'])
        self.assertIn('```apalas-preview-js```',run_bodies[0]['instructions'])


class QueueReadTests(unittest.TestCase):
    def test_active_runs_and_idle_waits_do_not_repeatedly_read_cloudflare(self):
        class Stop(BaseException): pass
        class Event:
            def __init__(self): self.waits=0
            def is_set(self): return False
            def clear(self): pass
            def wait(self,delay):
                self.waits+=1
                if self.waits==3: raise Stop()
        for pending in (False,True):
            with self.subTest(pending=pending):
                messages=[{'id':'test','person':'Dani','conversationId':'test','status':'pending','run':'test'}] if pending else []
                with patch.object(worker,'API_KEY','test'),patch.object(worker,'SERVICE_HEADERS',{'test':'test'}),patch.object(worker.threading,'Thread'),patch.object(worker.threading,'Event',return_value=Event()),patch.object(worker.time,'monotonic',return_value=0),patch.object(worker,'dashboard',return_value={'messages':messages}) as queue,patch.object(worker,'hermes_api',return_value={'status':'running'}) as local:
                    with self.assertRaises(Stop): worker.main()
                    self.assertEqual(queue.call_count,1)
                    self.assertEqual(local.call_count,3 if pending else 0)


if __name__=='__main__':unittest.main()
