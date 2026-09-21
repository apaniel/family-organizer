"""Bound queue reads while retaining a short delay during active chats."""

class PollSchedule:
    def __init__(self):
        self.idle_delay = 1
        self.error_delay = 2

    def success(self, messages):
        self.error_delay = 2
        if messages:
            self.idle_delay = 1
            return 2
        self.idle_delay = min(15, self.idle_delay * 2)
        return self.idle_delay

    def failure(self):
        self.error_delay = min(60, self.error_delay * 2)
        return self.error_delay
