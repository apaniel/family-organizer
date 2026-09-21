import unittest
from polling import PollSchedule

class PollingTests(unittest.TestCase):
    def test_idle_queue_backs_off_to_fifteen_seconds(self):
        schedule = PollSchedule()
        self.assertEqual([schedule.success([]) for _ in range(6)], [2, 4, 8, 15, 15, 15])

    def test_any_pending_work_restores_responsiveness(self):
        schedule = PollSchedule()
        for _ in range(10): schedule.success([])
        for status in ('queued', 'pending', 'steer_pending'):
            self.assertEqual(schedule.success([{'status': status}]), 2)
        self.assertEqual(schedule.success([]), 2)

    def test_errors_back_off_and_recovery_resets(self):
        schedule = PollSchedule()
        self.assertEqual([schedule.failure() for _ in range(7)], [4, 8, 16, 32, 60, 60, 60])
        schedule.success([])
        self.assertEqual(schedule.failure(), 4)

    def test_idle_day_stays_below_six_thousand_reads(self):
        schedule = PollSchedule()
        seconds, requests = 0, 0
        while seconds < 86400:
            requests += 1
            seconds += schedule.success([])
        self.assertLess(requests, 6000)

if __name__ == '__main__': unittest.main()
