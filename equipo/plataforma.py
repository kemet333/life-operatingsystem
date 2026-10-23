"""What differs between macOS, Windows and Linux for the team engine, in one place.

File locks, process groups, keeping the computer awake, desktop notices, the secret store (Keychain, Windows Credential
Manager, Secret Service) and where the app keeps its data. Everything is best effort except locks and killing processes.
"""
import os, shutil, signal, subprocess, sys, time
from pathlib import Path

WINDOWS = sys.platform == 'win32'
MAC = sys.platform == 'darwin'
APP_ID = 'com.lifeoperatingsystem.app'

if WINDOWS: import msvcrt
else: import fcntl

def lock(fh, block=True):
    """Exclusive lock on an open file; with block=False raises BlockingIOError when someone else holds it."""
    if WINDOWS:
        fh.seek(0)
        while True:
            try: msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1); return
            except OSError:
                if not block: raise BlockingIOError('ocupado')
                time.sleep(0.5)
    fcntl.flock(fh, fcntl.LOCK_EX | (0 if block else fcntl.LOCK_NB))

def session_kwargs():
    """Popen arguments that put the child in its own process group, so it can be killed with everything it started."""
    return {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if WINDOWS else {'start_new_session': True}

def kill_tree(proc, grace=2):
    if proc.poll() is not None: return
    if WINDOWS:
        subprocess.run(['taskkill', '/T', '/F', '/PID', str(proc.pid)], capture_output=True)
        return
    try: os.killpg(proc.pid, signal.SIGTERM); time.sleep(grace); os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError: pass

def kill_now(proc):
    if WINDOWS: subprocess.run(['taskkill', '/T', '/F', '/PID', str(proc.pid)], capture_output=True); return
    try: os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError: pass

class _Awake:
    """Keeps the computer from idle-sleeping until stopped (or until this process exits)."""
    def __init__(self, system):
        self.proc = None
        if MAC:
            try: self.proc = subprocess.Popen(['/usr/bin/caffeinate', '-i', *(['-s'] if system else []), '-w', str(os.getpid())],
                                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except OSError: pass
        elif WINDOWS:
            import ctypes   # ES_CONTINUOUS | ES_SYSTEM_REQUIRED, for this thread until reset
            try: ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)
            except Exception: pass
        elif shutil.which('systemd-inhibit'):
            try: self.proc = subprocess.Popen(['systemd-inhibit', '--what=idle:sleep', '--why=equipo', 'sleep', 'infinity'],
                                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except OSError: pass
    def terminate(self):
        if self.proc: self.proc.terminate()
        elif WINDOWS:
            import ctypes
            try: ctypes.windll.kernel32.SetThreadExecutionState(0x80000000)
            except Exception: pass

def keep_awake(system=False): return _Awake(system)

def lid_will_sleep():
    """Mac lid closed and nothing keeping it awake (no external display): it is about to sleep, don't start work."""
    if not MAC: return False
    try: out = subprocess.run(['/usr/sbin/ioreg', '-r', '-k', 'AppleClamshellState', '-d', '1'], capture_output=True, text=True, timeout=5).stdout
    except Exception: return False
    return '"AppleClamshellState" = Yes' in out and '"AppleClamshellCausesSleep" = Yes' in out

def notify(title, text, subtitle=''):
    """A desktop notice. Best effort: never raises."""
    import json
    try:
        if MAC:
            script = f'display notification {json.dumps(text)} with title {json.dumps(title)}' + (f' subtitle {json.dumps(subtitle)}' if subtitle else '')
            subprocess.run(['/usr/bin/osascript', '-e', script], capture_output=True, timeout=10)
        elif WINDOWS:
            ps = ('[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;'
                  '$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);'
                  f'$t = $x.GetElementsByTagName("text"); $t.Item(0).InnerText = {json.dumps(title)}; $t.Item(1).InnerText = {json.dumps(text)};'
                  '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Alfred").Show([Windows.UI.Notifications.ToastNotification]::new($x))')
            subprocess.run(['powershell', '-NoProfile', '-Command', ps], capture_output=True, timeout=15)
        elif shutil.which('notify-send'):
            subprocess.run(['notify-send', title, text], capture_output=True, timeout=10)
    except (OSError, subprocess.SubprocessError): pass

def secret(service):
    """A secret the app saved (e.g. the Telegram bot token), or '' if there is none. It never leaves this process."""
    try:
        if MAC:
            p = subprocess.run(['/usr/bin/security', 'find-generic-password', '-s', service, '-w'], capture_output=True, text=True, timeout=10)
            return p.stdout.strip() if p.returncode == 0 else ''
        if WINDOWS: return _cred_read(service)
        if shutil.which('secret-tool'):
            p = subprocess.run(['secret-tool', 'lookup', 'service', service], capture_output=True, text=True, timeout=10)
            return p.stdout.strip() if p.returncode == 0 else ''
    except (OSError, subprocess.SubprocessError): pass
    return ''

def _cred_read(target):
    import ctypes
    from ctypes import wintypes
    class CREDENTIAL(ctypes.Structure):
        _fields_ = [('Flags', wintypes.DWORD), ('Type', wintypes.DWORD), ('TargetName', wintypes.LPWSTR), ('Comment', wintypes.LPWSTR),
                    ('LastWritten', wintypes.FILETIME), ('CredentialBlobSize', wintypes.DWORD), ('CredentialBlob', ctypes.POINTER(ctypes.c_char)),
                    ('Persist', wintypes.DWORD), ('AttributeCount', wintypes.DWORD), ('Attributes', ctypes.c_void_p),
                    ('TargetAlias', wintypes.LPWSTR), ('UserName', wintypes.LPWSTR)]
    advapi = ctypes.windll.advapi32
    ptr = ctypes.POINTER(CREDENTIAL)()
    if not advapi.CredReadW(target, 1, 0, ctypes.byref(ptr)): return ''   # CRED_TYPE_GENERIC
    try:
        c = ptr.contents
        raw = ctypes.string_at(c.CredentialBlob, c.CredentialBlobSize)
        try: return raw.decode('utf-16-le' if b'\x00' in raw else 'utf-8').strip('\x00').strip()   # cmdkey and the app write UTF-16
        except UnicodeDecodeError: return ''
    finally: advapi.CredFree(ptr)

def app_data():
    """The app's data folder (Workspace): LIFE_OS_DATA_DIR, or where the desktop app keeps it on this system."""
    if os.environ.get('LIFE_OS_DATA_DIR'): return Path(os.environ['LIFE_OS_DATA_DIR'])
    if MAC: base = Path.home() / 'Library/Application Support'
    elif WINDOWS: base = Path(os.environ.get('APPDATA') or Path.home() / 'AppData/Roaming')
    else: base = Path(os.environ.get('XDG_CONFIG_HOME') or Path.home() / '.config')
    return base / APP_ID / 'Workspace'

def search_path():
    """PATH for the tools the team runs (git, node, claude, codex): the usual places first, then what this process has."""
    home = Path.home()
    extra = [home / '.local/bin', home / '.claude/local']
    if MAC: extra += [Path('/opt/homebrew/bin'), Path('/usr/local/bin'), Path('/usr/bin'), Path('/bin')]
    elif WINDOWS: extra += [Path(os.environ.get('APPDATA', '')) / 'npm', Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'nodejs',
                            Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Git/cmd']
    else: extra += [Path('/usr/local/bin'), Path('/usr/bin'), Path('/bin')]
    seen, out = set(), []
    for p in [*map(str, extra), *os.environ.get('PATH', '').split(os.pathsep)]:
        if p and p not in seen: seen.add(p); out.append(p)
    return os.pathsep.join(out)
