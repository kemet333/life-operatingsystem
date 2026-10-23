"""The team's own task boards: a small SQLite Kanban with the few operations the engine uses.

A fresh install has no Hermes; this module stands in for hermes_cli.kanban_db (and kanban_db_connect) with the same names
and the same meaning, so equipo.py works with either. One database per board under <EQUIPO_TABLEROS or ~/Equipo/state/tableros>.

States: todo (waiting for a parent) → ready → running → done | blocked; archived leaves the board. A task is ready only when
all its parents are done; finishing a task promotes its children.
"""
import json, os, sqlite3, threading, time, uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

_local = threading.local()

def home():
    return Path(os.environ.get('EQUIPO_TABLEROS') or Path.home() / 'Equipo/state/tableros')

def _path(slug):
    if not slug or '/' in slug or '\\' in slug or slug.startswith('.'): raise ValueError('tablero no válido: ' + str(slug))
    return home() / f'{slug}.db'

SCHEMA = '''
CREATE TABLE IF NOT EXISTS board (slug TEXT PRIMARY KEY, name TEXT, description TEXT, default_workdir TEXT, archived INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, assignee TEXT, status TEXT NOT NULL, priority INTEGER DEFAULT 0,
  created_by TEXT, created_at INTEGER, started_at INTEGER, completed_at INTEGER, workspace_kind TEXT, workspace_path TEXT,
  claim_lock TEXT, claim_expires INTEGER, branch_name TEXT, result TEXT, idempotency_key TEXT, max_retries INTEGER,
  current_run_id INTEGER, last_failure_error TEXT, consecutive_failures INTEGER DEFAULT 0, parents TEXT DEFAULT '[]');
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, kind TEXT, data TEXT, at INTEGER);
'''

@dataclass
class Task:
    id: str
    title: str
    body: Optional[str]
    assignee: Optional[str]
    status: str
    priority: int
    created_by: Optional[str]
    created_at: int
    started_at: Optional[int]
    completed_at: Optional[int]
    workspace_kind: Optional[str]
    workspace_path: Optional[str]
    claim_lock: Optional[str]
    claim_expires: Optional[int]
    branch_name: Optional[str] = None
    result: Optional[str] = None
    idempotency_key: Optional[str] = None
    max_retries: Optional[int] = None
    current_run_id: Optional[int] = None
    last_failure_error: Optional[str] = None
    consecutive_failures: int = 0
    parents: list = field(default_factory=list)

def _task(row):
    d = dict(row); d['parents'] = json.loads(d.get('parents') or '[]')
    return Task(**d)

def _open(slug):
    p = _path(slug); p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(p, timeout=30, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL'); conn.executescript(SCHEMA)
    return conn

@contextmanager
def scoped_current_board(slug):
    before = getattr(_local, 'board', None); _local.board = slug
    try: yield slug
    finally: _local.board = before

@contextmanager
def connect_closing(board=None):
    conn = _open(board or getattr(_local, 'board', None))
    try: yield conn
    finally: conn.close()

@contextmanager
def _txn(conn):
    conn.execute('BEGIN IMMEDIATE')
    try: yield
    except BaseException: conn.execute('ROLLBACK'); raise
    else: conn.execute('COMMIT')

def _event(conn, tid, kind, data=None):
    conn.execute('INSERT INTO events (task_id, kind, data, at) VALUES (?,?,?,?)', (tid, kind, json.dumps(data or {}, ensure_ascii=False), int(time.time())))

def _parents_done(conn, parents):
    if not parents: return True
    marks = ','.join('?' * len(parents))
    done = conn.execute(f"SELECT COUNT(*) FROM tasks WHERE id IN ({marks}) AND status IN ('done','archived')", parents).fetchone()[0]
    return done == len(parents)

def _promote(conn):
    for row in conn.execute("SELECT id, parents FROM tasks WHERE status='todo'").fetchall():
        if _parents_done(conn, json.loads(row['parents'] or '[]')):
            conn.execute("UPDATE tasks SET status='ready' WHERE id=?", (row['id'],)); _event(conn, row['id'], 'promoted')

def create_board(slug, name=None, description=None, default_workdir=None, **_):
    conn = _open(slug)
    try: conn.execute('INSERT OR IGNORE INTO board (slug, name, description, default_workdir) VALUES (?,?,?,?)', (slug, name or slug, description, default_workdir))
    finally: conn.close()
    return slug

def list_boards(include_archived=False):
    out = []
    for p in sorted(home().glob('*.db')):
        try:
            conn = _open(p.stem)
            try: row = conn.execute('SELECT * FROM board').fetchone()
            finally: conn.close()
        except sqlite3.Error: continue
        if row is None or (row['archived'] and not include_archived): continue
        out.append({'slug': row['slug'], 'name': row['name'], 'db_path': str(p), 'archived': bool(row['archived'])})
    return out

def create_task(conn, *, title, body=None, assignee=None, created_by=None, workspace_kind=None, workspace_path=None, branch_name=None,
                priority=0, parents=(), idempotency_key=None, max_retries=None, board=None, **_):
    parents = list(parents or [])
    with _txn(conn):
        if idempotency_key:
            row = conn.execute("SELECT id FROM tasks WHERE idempotency_key=? AND status!='archived'", (idempotency_key,)).fetchone()
            if row: return row['id']
        tid = 't_' + uuid.uuid4().hex[:8]
        status = 'ready' if _parents_done(conn, parents) else 'todo'
        conn.execute('INSERT INTO tasks (id, title, body, assignee, status, priority, created_by, created_at, workspace_kind, workspace_path, '
                     'branch_name, idempotency_key, max_retries, parents) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                     (tid, title, body, assignee, status, priority, created_by, int(time.time()), workspace_kind, workspace_path,
                      branch_name, idempotency_key, max_retries, json.dumps(parents)))
        _event(conn, tid, 'created', {'status': status})
    return tid

def get_task(conn, tid):
    row = conn.execute('SELECT * FROM tasks WHERE id=?', (tid,)).fetchone()
    return _task(row) if row else None

def list_tasks(conn, status=None, **_):
    q, args = 'SELECT * FROM tasks', ()
    if status: q, args = q + ' WHERE status=?', (status,)
    return [_task(r) for r in conn.execute(q + ' ORDER BY priority DESC, created_at ASC', args).fetchall()]

def claim_task(conn, tid, *, ttl_seconds=600, claimer=None):
    """ready → running, atomically. None when it was not ready (or a parent reopened)."""
    now = int(time.time())
    with _txn(conn):
        row = conn.execute("SELECT parents FROM tasks WHERE id=? AND status='ready'", (tid,)).fetchone()
        if row is None: return None
        if not _parents_done(conn, json.loads(row['parents'] or '[]')):
            conn.execute("UPDATE tasks SET status='todo' WHERE id=?", (tid,)); return None
        run = (conn.execute('SELECT COALESCE(MAX(current_run_id),0) FROM tasks').fetchone()[0] or 0) + 1
        conn.execute("UPDATE tasks SET status='running', claim_lock=?, claim_expires=?, started_at=?, current_run_id=? WHERE id=?",
                     (claimer or uuid.uuid4().hex, now + (ttl_seconds or 600), now, run, tid))
        _event(conn, tid, 'claimed', {'run': run})
    return get_task(conn, tid)

def heartbeat_claim(conn, tid, *, ttl_seconds=600, claimer=None):
    with _txn(conn):
        cur = conn.execute("UPDATE tasks SET claim_expires=? WHERE id=? AND status='running' AND claim_lock=?",
                           (int(time.time()) + (ttl_seconds or 600), tid, claimer))
    return cur.rowcount == 1

def _finish(conn, tid, status, expected_run_id, **cols):
    with _txn(conn):
        row = conn.execute('SELECT status, current_run_id FROM tasks WHERE id=?', (tid,)).fetchone()
        if row is None or row['status'] != 'running' or (expected_run_id is not None and row['current_run_id'] != expected_run_id): return False
        sets = ', '.join(f'{k}=?' for k in cols)
        conn.execute(f"UPDATE tasks SET status=?, claim_lock=NULL, claim_expires=NULL{', ' + sets if sets else ''} WHERE id=?",
                     (status, *cols.values(), tid))
        _event(conn, tid, status, cols)
        if status == 'done': _promote(conn)
    return True

def complete_task(conn, tid, *, result=None, summary=None, expected_run_id=None, **_):
    return _finish(conn, tid, 'done', expected_run_id, result=result or summary, completed_at=int(time.time()), consecutive_failures=0)

def block_task(conn, tid, *, reason=None, kind=None, expected_run_id=None, **_):
    return _finish(conn, tid, 'blocked', expected_run_id, last_failure_error=reason)

def reclaim_task(conn, tid, *, reason=None, signal_fn=None, **_):
    """running → ready (nothing failed: the attempt is given back)."""
    with _txn(conn):
        cur = conn.execute("UPDATE tasks SET status='ready', claim_lock=NULL, claim_expires=NULL WHERE id=? AND status='running'", (tid,))
        if cur.rowcount: _event(conn, tid, 'reclaimed', {'reason': reason})
    return cur.rowcount == 1

def unblock_task(conn, tid):
    with _txn(conn):
        row = conn.execute("SELECT parents FROM tasks WHERE id=? AND status='blocked'", (tid,)).fetchone()
        if row is None: return False
        status = 'ready' if _parents_done(conn, json.loads(row['parents'] or '[]')) else 'todo'
        conn.execute('UPDATE tasks SET status=?, last_failure_error=NULL WHERE id=?', (status, tid))
        _event(conn, tid, 'unblocked', {'status': status})
    return True

def archive_task(conn, tid, *, signal_fn=None):
    with _txn(conn):
        cur = conn.execute("UPDATE tasks SET status='archived', claim_lock=NULL, claim_expires=NULL WHERE id=? AND status!='archived'", (tid,))
        if cur.rowcount: _event(conn, tid, 'archived'); _promote(conn)
    return cur.rowcount == 1
