"""The team's own boards (tablero.py): the Hermes operations the engine uses, with the same meaning. Temporary folders only."""
import json, os, subprocess, sys, tempfile, unittest
from dataclasses import asdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import tablero as kb

class Tablero(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ['EQUIPO_TABLEROS'] = self.tmp.name
        kb.create_board('equipo-demo', name='Equipo · Demo', default_workdir='/tmp')

    def tearDown(self):
        self.tmp.cleanup()

    def conn(self):
        return kb.connect_closing(board='equipo-demo')

    def test_lifecycle_and_parents(self):
        with kb.scoped_current_board('equipo-demo'), self.conn() as c:
            a = kb.create_task(c, title='A', body='{}', assignee='equipo-constructor', idempotency_key='k:a')
            b = kb.create_task(c, title='B', parents=[a])
            self.assertEqual(kb.create_task(c, title='A otra vez', idempotency_key='k:a'), a)
            self.assertEqual({t.title: t.status for t in kb.list_tasks(c)}, {'A': 'ready', 'B': 'todo'})
            self.assertEqual([t.id for t in kb.list_tasks(c, status='ready')], [a])
            self.assertIsNone(kb.claim_task(c, b, claimer='x'))
            t = kb.claim_task(c, a, ttl_seconds=600, claimer='yo')
            self.assertEqual(t.status, 'running')
            self.assertIsNone(kb.claim_task(c, a, claimer='otro'))
            self.assertTrue(kb.heartbeat_claim(c, a, ttl_seconds=600, claimer='yo'))
            self.assertFalse(kb.heartbeat_claim(c, a, ttl_seconds=600, claimer='otro'))
            self.assertFalse(kb.complete_task(c, a, summary='x', expected_run_id=t.current_run_id + 1))
            self.assertTrue(kb.complete_task(c, a, result='hecho', summary='hecho', expected_run_id=t.current_run_id))
            done = kb.get_task(c, a)
            self.assertEqual((done.status, done.result), ('done', 'hecho'))
            self.assertTrue(done.completed_at)
            self.assertEqual(kb.get_task(c, b).status, 'ready')
            self.assertIn('created_at', asdict(done))

    def test_block_unblock_reclaim_archive(self):
        with self.conn() as c:
            a = kb.create_task(c, title='A')
            run = kb.claim_task(c, a, claimer='yo').current_run_id
            self.assertTrue(kb.reclaim_task(c, a, reason='dormido', signal_fn=lambda *x, **k: None))
            self.assertEqual(kb.get_task(c, a).status, 'ready')
            run = kb.claim_task(c, a, claimer='yo').current_run_id
            self.assertTrue(kb.block_task(c, a, reason='falla', kind='needs_input', expected_run_id=run))
            self.assertEqual((kb.get_task(c, a).status, kb.get_task(c, a).last_failure_error), ('blocked', 'falla'))
            self.assertTrue(kb.unblock_task(c, a))
            self.assertFalse(kb.unblock_task(c, a))
            self.assertTrue(kb.archive_task(c, a))
            self.assertFalse(kb.archive_task(c, a))
            self.assertEqual(kb.get_task(c, a).status, 'archived')

    def test_boards_listed_and_slugs_checked(self):
        self.assertEqual([b['slug'] for b in kb.list_boards()], ['equipo-demo'])
        with self.assertRaises(ValueError): kb.create_board('../fuera')

class MotorSinHermes(unittest.TestCase):
    def test_engine_runs_on_its_own_boards(self):
        """A fresh computer: no Hermes, the app's data folder elsewhere, a project repository with its team branch."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp); repo = tmp / 'repo'; repo.mkdir()
            for cmd in (['init', '-q', '-b', 'main'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x']):
                subprocess.run(['git', '-C', str(repo), *cmd], check=True)
            cfg = {'root': str(tmp / 'Equipo'), 'model': 'claude-sonnet-5-5', 'tablero': 'propio',
                   'limits': {'parallel': 1, 'tasks_per_batch': 2, 'attempts': 2, 'plan_seconds': 60, 'builder_seconds': 60, 'review_seconds': 60},
                   'projects': {'demo': {'name': 'Demo', 'repo': str(repo), 'base': 'main', 'board': 'equipo-demo', 'goal': 'g', 'tests': []}}}
            (tmp / 'projects.json').write_text(json.dumps(cfg))
            env = {**os.environ, 'EQUIPO_CONFIG': str(tmp / 'projects.json'), 'LIFE_OS_DATA_DIR': str(tmp / 'datos'), 'HOME': str(tmp)}
            env.pop('EQUIPO_TABLEROS', None)
            code = ('import equipo as e; assert not e.HERMES; e.setup(); '
                    'print(e.tasks("demo"), e.git(e.project("demo")["repo"], "branch", "--list", "equipo/demo"))')
            p = subprocess.run([sys.executable, '-c', code], cwd=HERE, env=env, capture_output=True, text=True, timeout=60)
            self.assertEqual(p.returncode, 0, p.stderr[-2000:])
            self.assertIn('equipo/demo', p.stdout)
            self.assertTrue((tmp / 'Equipo/state/tableros/equipo-demo.db').exists())

if __name__ == '__main__':
    unittest.main()
