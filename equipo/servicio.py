#!/usr/bin/env python3
"""The team's schedule on this computer: the engine's `run` every 5 minutes, the day's plan at 7:30 and the night merge at 23:30.

  python servicio.py instalar | quitar | estado

macOS: LaunchAgents. Windows: the Task Scheduler (no console window: each job goes through `lanzar`, which writes the logs).
Linux: the user's crontab, between two marker lines. Runs with the same Python that runs this script.
"""
import json, os, plistlib, runpy, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import plataforma as pf

ENGINE = HERE / 'equipo.py'
LOGS = Path(os.path.expanduser(os.environ.get('EQUIPO_LOGS') or '~/Equipo/logs'))
PREFIX = pf.APP_ID.rsplit('.', 1)[0] + '.equipo'          # launchd labels and the Task Scheduler folder
JOBS = {'run': None, 'plan': (7, 30), 'fusionar': (23, 30)}    # None = every 5 minutes
MARK = f'# {PREFIX} (servicio.py)'

def python():
    """pythonw on Windows, so no console window opens every five minutes."""
    exe = Path(sys.executable)
    if pf.WINDOWS and (exe.parent / 'pythonw.exe').exists(): return str(exe.parent / 'pythonw.exe')
    return str(exe)

# ---------- macOS ----------

def _plist(job, when):
    d = {'Label': f'{PREFIX}.{job}', 'ProgramArguments': [python(), str(ENGINE), job], 'LowPriorityIO': True,
         'StandardOutPath': str(LOGS / f'{job}.log'), 'StandardErrorPath': str(LOGS / f'{job}.err.log')}
    if when: d['StartCalendarInterval'] = {'Hour': when[0], 'Minute': when[1]}
    else: d.update(StartInterval=300, RunAtLoad=True)
    return d

def mac(install):
    agents = Path.home() / 'Library/LaunchAgents'; agents.mkdir(parents=True, exist_ok=True)
    for job, when in JOBS.items():
        label = f'{PREFIX}.{job}'; path = agents / f'{label}.plist'
        subprocess.run(['launchctl', 'bootout', f'gui/{os.getuid()}/{label}'], capture_output=True)
        path.unlink(missing_ok=True)
        if install:
            path.write_bytes(plistlib.dumps(_plist(job, when)))
            subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(path)], check=True)

# ---------- Windows ----------

def windows(install):
    for job, when in JOBS.items():
        name = f'{PREFIX}\\{job}'
        subprocess.run(['schtasks', '/Delete', '/F', '/TN', name], capture_output=True)
        if not install: continue
        action = f'"{python()}" "{Path(__file__).resolve()}" lanzar {job}'
        when_args = ['/SC', 'DAILY', '/ST', f'{when[0]:02d}:{when[1]:02d}'] if when else ['/SC', 'MINUTE', '/MO', '5']
        subprocess.run(['schtasks', '/Create', '/F', '/TN', name, '/TR', action, *when_args], check=True, capture_output=True)

# ---------- Linux ----------

def linux(install):
    current = subprocess.run(['crontab', '-l'], capture_output=True, text=True).stdout
    keep, skip = [], False
    for line in current.splitlines():
        if line == MARK: skip = not skip; continue
        if not skip: keep.append(line)
    if install:
        keep.append(MARK)
        for job, when in JOBS.items():
            spec = f'{when[1]} {when[0]} * * *' if when else '*/5 * * * *'
            keep.append(f'{spec} "{python()}" "{ENGINE}" {job} >> "{LOGS / (job + ".log")}" 2>&1')
        keep.append(MARK)
    subprocess.run(['crontab', '-'], input='\n'.join(keep) + '\n', text=True, check=True)

def lanzar(job):
    """Windows: run one engine job with its output in the logs and no console windows for the tools it starts."""
    LOGS.mkdir(parents=True, exist_ok=True)
    out = open(LOGS / f'{job}.log', 'a', encoding='utf-8', buffering=1)
    sys.stdout = sys.stderr = out
    if pf.WINDOWS:
        original = subprocess.Popen.__init__
        def quiet(self, *a, **k):
            k['creationflags'] = k.get('creationflags', 0) | 0x08000000      # CREATE_NO_WINDOW
            original(self, *a, **k)
        subprocess.Popen.__init__ = quiet
    sys.argv = [str(ENGINE), job]
    runpy.run_path(str(ENGINE), run_name='__main__')

def estado():
    if pf.MAC:
        out = subprocess.run(['launchctl', 'list'], capture_output=True, text=True).stdout
        return {job: f'{PREFIX}.{job}' in out for job in JOBS}
    if pf.WINDOWS:
        return {job: subprocess.run(['schtasks', '/Query', '/TN', f'{PREFIX}\\{job}'], capture_output=True).returncode == 0 for job in JOBS}
    cron = subprocess.run(['crontab', '-l'], capture_output=True, text=True).stdout
    return {job: f'"{ENGINE}" {job}' in cron for job in JOBS}

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'estado'
    if cmd == 'lanzar': return lanzar(sys.argv[2])
    if cmd == 'estado': print(json.dumps(estado())); return
    if cmd not in ('instalar', 'quitar'): sys.exit('usa: servicio.py instalar | quitar | estado')
    LOGS.mkdir(parents=True, exist_ok=True)
    (mac if pf.MAC else windows if pf.WINDOWS else linux)(cmd == 'instalar')
    print('Servicio del equipo instalado: tareas cada 5 min, plan a las 7:30, fusión a las 23:30.' if cmd == 'instalar'
          else 'Servicio del equipo quitado.')

if __name__ == '__main__':
    main()
