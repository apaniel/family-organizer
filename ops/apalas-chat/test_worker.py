import unittest
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


if __name__=='__main__':unittest.main()
