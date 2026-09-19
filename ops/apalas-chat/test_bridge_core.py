import unittest

from bridge_core import attachment_allowed, compose_input, submission_action


class BridgeCoreTests(unittest.TestCase):
    def test_queue_waits_behind_active_run_and_starts_when_idle(self):
        self.assertEqual(submission_action('queue', True), 'queue')
        self.assertEqual(submission_action('queue', False), 'start')

    def test_steer_requires_an_active_run(self):
        self.assertEqual(submission_action('steer', True), 'steer')
        self.assertEqual(submission_action('steer', False), 'start')

    def test_plain_send_does_not_silently_queue(self):
        self.assertEqual(submission_action('send', False), 'start')
        with self.assertRaisesRegex(ValueError, 'respuesta anterior'):
            submission_action('send', True)

    def test_attachments_accept_family_media_and_documents_but_not_executables(self):
        for name, mime in [('foto.jpg', 'image/jpeg'), ('voz.m4a', 'audio/mp4'), ('video.mp4', 'video/mp4'), ('nota.pdf', 'application/pdf'), ('lista.txt', 'text/plain')]:
            self.assertTrue(attachment_allowed(name, mime, 1024), name)
        self.assertFalse(attachment_allowed('script.exe', 'application/x-msdownload', 1024))
        self.assertFalse(attachment_allowed('huge.pdf', 'application/pdf', 25 * 1024 * 1024 + 1))

    def test_attachment_context_uses_private_paths_without_changing_user_text(self):
        prompt = compose_input('Revísalo', [{'filename': 'foto.jpg', 'mime': 'image/jpeg', 'path': '/var/lib/apalas-chat/uploads/a.jpg'}])
        self.assertTrue(prompt.startswith('Revísalo'))
        self.assertIn('/var/lib/apalas-chat/uploads/a.jpg', prompt)
        self.assertIn('image/jpeg', prompt)
        self.assertIn('Usa las herramientas', prompt)


if __name__ == '__main__':
    unittest.main()
