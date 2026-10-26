"""Unit tests for the team engine. Run: ~/Equipo/venv/bin/python -m unittest discover -s equipo"""
import inspect, io, json, os, re, subprocess, sys, tempfile, unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

# Fixed example projects, never this computer's real configuration (paths, boards).
os.environ.setdefault('EQUIPO_CONFIG', str(Path(__file__).resolve().with_name('test_proyectos.json')))
import equipo

# No test may reach Owner's real data folder or send him anything: run_all() now writes and sends the morning to-do
# (19/10: a run_all test with a simulated date sent him a real «Hoy, jue 15»). Tests that need them patch these again.
_ISOLATION = tempfile.TemporaryDirectory()
_GUARDS = [mock.patch.object(equipo, 'WORKSPACE', Path(_ISOLATION.name)), mock.patch.object(equipo, 'TELEGRAM_LINK', Path(_ISOLATION.name) / 'telegram.json'),
           mock.patch.object(equipo, 'telegram_send', lambda *a, **k: None)]   # telegram() finds no linked chat in the temporary folder
def setUpModule():
    for g in _GUARDS: g.start()
def tearDownModule():
    for g in _GUARDS: g.stop()
    _ISOLATION.cleanup()
# The tests describe Codex arriving on 10/10 at 14:30, whatever date modelos.json holds today.
equipo.MODEL_POLICY = {**equipo.MODEL_POLICY, 'codex': {**equipo.MODEL_POLICY.get('codex', {}), 'desde': '2026-10-10 14:30'}}


def solo_claude():
    """Claude builds: the model checks must not depend on the date or on this Mac's Codex."""
    return mock.patch.object(equipo, 'codex_ready', lambda: False)


class FusionarExperimentos(unittest.TestCase):
    ahora = datetime.fromisoformat('2026-10-20T02:00:00+02:00')

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)
        patches = {'STATE': self.state, 'now': mock.Mock(return_value=self.ahora),
                   'fusionar_project': mock.Mock(return_value='fusionada en main'),
                   'experimentos': mock.Mock(return_value={'por_lanzar': []}),
                   'project': mock.Mock(return_value={'name': 'Owner OS'}),
                   'log': mock.Mock(), 'notify': mock.Mock(), 'mejoras_vigentes': mock.Mock(return_value=[])}
        for name, value in patches.items():
            patch = mock.patch.object(equipo, name, value)
            patch.start(); self.addCleanup(patch.stop)

    def test_marks_only_unmerged_experiments_of_successful_project(self):
        entry = {'proyecto': 'owner-os', 'sin_fusionar': True}
        registro = {'t_a': entry, 't_b': {**entry, 'proyecto': 'alfa'},
                    't_c': {**entry, 'fusionado': '2026-10-18T12:00:00+02:00'},
                    't_d': {'proyecto': 'owner-os'}, 't_rota': None}
        equipo.save(self.state / 'experimentos.json', registro)
        equipo.fusionar_project.side_effect = lambda pid: 'fusionada en main' if pid == 'owner-os' else 'conflicto: necesita a Owner'
        with mock.patch.object(equipo, 'lanzamientos', wraps=equipo.lanzamientos) as leer:
            equipo.fusionar(['owner-os', 'alfa'])
        leer.assert_called_once_with()
        self.assertEqual(equipo.lanzamientos(), {**registro, 't_a': {**entry, 'fusionado': self.ahora.isoformat(timespec='seconds')}})

    def test_conflict_does_not_mark_or_save_experiments(self):
        registro = {'t_a': {'proyecto': 'owner-os', 'sin_fusionar': True}}
        equipo.save(self.state / 'experimentos.json', registro)
        equipo.fusionar_project.return_value = 'conflicto: necesita a Owner'
        with mock.patch.object(equipo, 'save', wraps=equipo.save) as guardar:
            equipo.fusionar(['owner-os'])
        self.assertEqual(equipo.lanzamientos(), registro)
        self.assertEqual([c.args[0] for c in guardar.call_args_list], [self.state / 'fusiones' / 'ultima.json'])

    def test_registry_write_failure_is_logged_without_interrupting_notice(self):
        equipo.save(self.state / 'experimentos.json', {'t_a': {'proyecto': 'owner-os', 'sin_fusionar': True}})
        save = equipo.save
        def guardar(path, value):
            if path == self.state / 'experimentos.json': raise OSError('sin espacio')
            return save(path, value)
        with mock.patch.object(equipo, 'save', side_effect=guardar):
            self.assertEqual(equipo.fusionar(['owner-os']), {'owner-os': 'fusionada en main'})
        equipo.log.assert_any_call('equipo', 'No se han podido actualizar los experimentos tras fusionar:', 'sin espacio')
        equipo.notify.assert_called_once_with('Mejoras del equipo', 'Owner OS: fusionada en main')

    def test_success_lists_two_pending_titles_once(self):
        equipo.experimentos.return_value = {'por_lanzar': [{'titulo': 'A'}, {'titulo': 'B'}]}
        equipo.fusionar(['owner-os'])
        equipo.experimentos.assert_called_once_with('owner-os')
        equipo.notify.assert_called_once_with('Mejoras del equipo', 'Owner OS: fusionada en main\n'
                                             'Owner OS: ya en la versión principal, listo para lanzar: «A», «B» (/lote)')

    def test_success_without_pending_keeps_notice(self):
        equipo.fusionar(['owner-os'])
        equipo.experimentos.assert_called_once_with('owner-os')
        equipo.notify.assert_called_once_with('Mejoras del equipo', 'Owner OS: fusionada en main')

    def test_success_lists_remaining_pending_titles_count(self):
        equipo.experimentos.return_value = {'por_lanzar': [{'titulo': title} for title in 'ABCDE'], 'por_lanzar_total': 7}
        equipo.fusionar(['owner-os'])
        equipo.notify.assert_called_once_with('Mejoras del equipo', 'Owner OS: fusionada en main\n'
                                             'Owner OS: ya en la versión principal, listo para lanzar: «A», «B», «C», «D», «E» y 2 más (/lote)')

    def test_success_with_five_pending_titles_has_no_remaining_count(self):
        equipo.experimentos.return_value = {'por_lanzar': [{'titulo': title} for title in 'ABCDE'], 'por_lanzar_total': 5}
        equipo.fusionar(['owner-os'])
        equipo.notify.assert_called_once_with('Mejoras del equipo', 'Owner OS: fusionada en main\n'
                                             'Owner OS: ya en la versión principal, listo para lanzar: «A», «B», «C», «D», «E» (/lote)')
        self.assertNotIn('más', equipo.notify.call_args.args[1])

    def test_unsuccessful_results_do_not_read_experiments(self):
        for result in ('conflicto: necesita a Owner o a Hermes', 'pruebas peores que en la base: equipo',
                       'error: fallo', 'nada que fusionar'):
            with self.subTest(result=result):
                equipo.fusionar_project.return_value = result
                equipo.notify.reset_mock()
                equipo.fusionar(['owner-os'])
                equipo.experimentos.assert_not_called()
                if result == 'nada que fusionar':
                    equipo.notify.assert_not_called()
                else:
                    equipo.notify.assert_called_once_with('Mejoras del equipo', f'Owner OS: {result}')

    def test_experiment_failure_is_logged_and_notice_still_sent(self):
        equipo.experimentos.side_effect = RuntimeError('registro ilegible')
        equipo.fusionar(['owner-os'])
        equipo.experimentos.assert_called_once_with('owner-os')
        equipo.log.assert_any_call('owner-os', 'No se han podido leer los experimentos tras fusionar:', 'registro ilegible')
        equipo.notify.assert_called_once_with('Mejoras del equipo', 'Owner OS: fusionada en main')

    def test_return_and_saved_results_stay_unchanged_for_multiple_projects(self):
        results = {'owner-os': 'fusionada en main', 'alfa': 'fusionada en main y subida a GitHub',
                   'tf': 'conflicto: necesita a Owner o a Hermes', 'otro': 'nada que fusionar'}
        equipo.fusionar_project.side_effect = results.__getitem__
        equipo.project.side_effect = lambda pid: {'name': pid}
        equipo.experimentos.return_value = {'por_lanzar': [{'titulo': 'A'}, {'titulo': 'B'}]}
        self.assertEqual(equipo.fusionar(list(results)), results)
        self.assertEqual(json.loads((self.state / 'fusiones' / 'ultima.json').read_text()),
                         {'fecha': self.ahora.isoformat(timespec='seconds'), 'resultados': results})
        self.assertEqual(equipo.experimentos.call_args_list, [mock.call('owner-os'), mock.call('alfa')])
        equipo.notify.assert_called_once_with('Mejoras del equipo',
                                             'owner-os: fusionada en main\nalfa: fusionada en main y subida a GitHub\n'
                                             'tf: conflicto: necesita a Owner o a Hermes\n'
                                             'owner-os: ya en la versión principal, listo para lanzar: «A», «B» (/lote)\n'
                                             'alfa: ya en la versión principal, listo para lanzar: «A», «B» (/lote)')


class Validation(unittest.TestCase):
    def test_safe_paths(self):
        self.assertTrue(equipo.safe_rel('alfred-os/app/x.tsx'))
        for bad in ('/etc/passwd', '../x', 'a/../../b', '.env', 'conf/.env.local', 'node_modules/x.js', 'CLAUDE.md', '.git/config', ''):
            self.assertFalse(equipo.safe_rel(bad), bad)

    def test_task_shape(self):
        ok = {'titulo': 'Una tarea', 'porque': 'x', 'detalle': 'Criterios de aceptación concretos', 'archivos': ['alfred-os/app/a.tsx'], 'pruebas': ['tipos'], 'depende_de': []}
        self.assertEqual(equipo.validate_task('owner-os', ok, 0)['archivos'], ['alfred-os/app/a.tsx'])
        for change in ({'pruebas': ['rm -rf']}, {'archivos': ['../fuera']}, {'archivos': []}, {'depende_de': [0]}, {'titulo': 'x'}):
            with self.assertRaises(AssertionError, msg=change):
                equipo.validate_task('owner-os', {**ok, **change}, 0)

    def test_long_title_is_trimmed_not_fatal(self):
        long = {'titulo': 'Prueba de integración de KC_SEED: misma semilla en dos arranques da las mismas posiciones, y otra cosa más larga que sigue y sigue hasta pasar el límite', 'porque': 'x',
                'detalle': 'Criterios de aceptación concretos', 'archivos': ['alfred-os/app/a.tsx'], 'pruebas': ['tipos'], 'depende_de': []}
        out = equipo.validate_task('owner-os', long, 0)
        self.assertLessEqual(len(out['titulo']), 120)
        self.assertTrue(out['titulo'].endswith('…'))

    def test_json_block(self):
        self.assertEqual(equipo.json_block('Texto\n```json\n[{"a": 1}]\n```\nfin'), [{'a': 1}])
        self.assertEqual(equipo.json_block('respuesta {"decision": "aprobar"}'), {'decision': 'aprobar'})
        with self.assertRaises(equipo.Stop):
            equipo.json_block('sin json')


class SiguienteExperimento(unittest.TestCase):
    ficha = {'que': 'Landing A/B', 'a_quien': 'Tráfico frío', 'metrica': 'Registros', 'umbral': '5 %'}
    ahora = datetime.fromisoformat('2026-10-19T12:00:00+02:00')

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)
        self.propuesta = {'titulo': 'Siguiente experimento', 'detalle': 'Criterios de aceptación concretos',
                          'archivos': ['equipo/equipo.py'], 'pruebas': ['equipo'], 'lanzamiento': self.ficha, 'viene_de': 't_padre'}
        self.padre = {'tarea': 't_padre', 'titulo': 'Experimento padre', 'decision': 'seguir', 'hora': self.ahora.isoformat()}
        patches = [mock.patch.object(equipo, 'STATE', self.state), mock.patch.object(equipo, 'now', lambda: self.ahora),
                   mock.patch.object(equipo, 'lessons_text', lambda pid, role: ''), mock.patch.object(equipo, 'mesa_load', lambda: {}),
                   mock.patch.object(equipo, 'metrics', lambda pid: {'tareas': 0})]
        for patch in patches: patch.start(); self.addCleanup(patch.stop)
        equipo.save(self.state / 'experimentos' / 'owner-os.json', [self.padre])

    def test_validation_keeps_only_a_followed_parent_with_a_launch_card(self):
        self.assertEqual(equipo.validate_task('owner-os', self.propuesta, 0)['viene_de'], 't_padre')
        for change in ({'viene_de': 't_ausente'}, {'viene_de': '../mal'}, {'viene_de': 123},
                       {'lanzamiento': None}, {'lanzamiento': {'que': 'Incompleta'}}):
            with self.subTest(change=change):
                self.assertNotIn('viene_de', equipo.validate_task('owner-os', {**self.propuesta, **change}, 0))
        sin_ficha = {k: v for k, v in self.propuesta.items() if k != 'lanzamiento'}
        self.assertNotIn('viene_de', equipo.validate_task('owner-os', sin_ficha, 0))
        equipo.save(self.state / 'experimentos' / 'owner-os.json', [{**self.padre, 'decision': 'parar'}])
        self.assertNotIn('viene_de', equipo.validate_task('owner-os', self.propuesta, 0))
        sin_padre = {k: v for k, v in self.propuesta.items() if k != 'viene_de'}
        with mock.patch.object(equipo, 'resultados') as leer:
            self.assertNotIn('viene_de', equipo.validate_task('owner-os', sin_padre, 0))
        leer.assert_not_called()

    def test_notice_keeps_valid_parent_only_on_first_notice_and_result_keeps_it(self):
        task = {'id': 't_hijo', 'title': 'Siguiente experimento', 'body': json.dumps(self.propuesta)}
        with mock.patch.object(equipo, 'telegram') as telegram, mock.patch.object(equipo, 'post') as post:
            texto = equipo.avisar_lanzamiento('owner-os', task)
            registro = equipo.lanzamientos()
            self.assertEqual(registro['t_hijo']['viene_de'], 't_padre')
            telegram.assert_called_once()
            self.assertEqual(telegram.call_args.args[0], texto)
            self.assertEqual(post.call_args.args[2], texto)
            equipo.avisar_lanzamiento('owner-os', {**task, 'body': json.dumps({**self.propuesta, 'viene_de': 't_otro'})})
            self.assertEqual(equipo.lanzamientos(), registro)
            for parent in ('../mal', 123, None):
                equipo.avisar_lanzamiento('owner-os', {**task, 'id': 't_invalido', 'body': json.dumps({**self.propuesta, 'viene_de': parent})})
                self.assertNotIn('viene_de', equipo.lanzamientos()['t_invalido'])
                equipo.save(self.state / 'experimentos.json', registro)
        with mock.patch.object(equipo, 'tasks', return_value=[task]):
            resultado = equipo.registrar_resultado('owner-os', '42 registros de 600 visitas', 't_hijo')
        self.assertEqual(resultado['viene_de'], 't_padre')
        self.assertEqual(equipo.resultados('owner-os')[-1], resultado)

    def test_counts_followed_results_in_window_with_an_announced_child(self):
        self.assertEqual(equipo.experimentos('owner-os')['seguir_con_siguiente'], 0)
        hijo = {'proyecto': 'owner-os', 'viene_de': 't_padre'}
        equipo.save(self.state / 'experimentos.json', {'t_hijo': hijo})
        self.assertEqual(equipo.experimentos('owner-os')['seguir_con_siguiente'], 0)
        hijo['avisado'] = self.ahora.isoformat()
        equipo.save(self.state / 'experimentos.json', {'t_hijo': hijo, 't_otro_hijo': hijo})
        with mock.patch.object(equipo, 'lanzamientos', wraps=equipo.lanzamientos) as leer:
            self.assertEqual(equipo.experimentos('owner-os')['seguir_con_siguiente'], 1)
        leer.assert_called_once()
        for change in ({'decision': 'parar'}, {'hora': 'rota'}, {'hora': '2026-10-01T12:00:00+02:00'}, {'tarea': None}):
            with self.subTest(change=change):
                equipo.save(self.state / 'experimentos' / 'owner-os.json', [{**self.padre, **change}])
                self.assertEqual(equipo.experimentos('owner-os')['seguir_con_siguiente'], 0)

    def test_planner_names_parent_and_followed_count(self):
        signals = equipo.planner_signals('owner-os')
        self.assertIn('Si propones el siguiente paso de una de ellas, añade a la propuesta "viene_de" con el id de su tarea: «Experimento padre» → t_padre', signals)
        self.assertIn('Con «seguir» (7 días): 1, con siguiente paso avisado: 0.', signals)
        equipo.save(self.state / 'experimentos.json', {'t_hijo': {'proyecto': 'owner-os', 'viene_de': 't_padre', 'avisado': self.ahora.isoformat()}})
        self.assertIn('Con «seguir» (7 días): 1, con siguiente paso avisado: 1.', equipo.planner_signals('owner-os'))

    def test_plan_prompt_formats_with_plan_project_arguments(self):
        prompt = equipo.PLAN_PROMPT.format(validar=equipo.VALIDAR, estrategia='', name='Owner OS', goal='Validar',
                                          n=equipo.LIMITS['tasks_per_batch'], max_files=equipo.LIMITS['max_files'],
                                          tests='equipo', board='[]', followups='[]', related='', learning='', context='')
        self.assertIn('"viene_de": "<id de esa tarea>"', prompt)


class Lessons(unittest.TestCase):
    def test_add_reinforce_retire_and_dedupe(self):
        current = [{'id': 'L1', 'para': 'constructor', 'texto': 'Actualiza siempre la prueba que cubre el archivo tocado.', 'refuerzos': 0, 'ultima': '2026-10-01'},
                   {'id': 'L2', 'para': 'planificador', 'texto': 'Divide las tareas de interfaz en tareas de menos de 100 líneas.', 'refuerzos': 0, 'ultima': '2026-10-01'}]
        out = equipo.merge_lessons(current, {'refuerzan': ['L1'], 'retirar': ['L2'], 'nuevas': [
            {'para': 'revisor', 'texto': 'Comprueba que el cambio no toca la pantalla Alfred.', 'evidencia': ['t_1']},
            {'para': 'constructor', 'texto': 'actualiza siempre la prueba que cubre el archivo tocado.'},   # duplicate
            {'para': 'nadie', 'texto': 'Rol inválido, se descarta entera.'},
            {'para': 'todos', 'texto': 'corta'}]}, today_='2026-10-05')
        self.assertEqual([l['id'] for l in out], ['L1', 'L3'])
        self.assertEqual(out[0]['refuerzos'], 1)
        self.assertEqual(out[1]['evidencia'], ['t_1'])

    def test_cap_keeps_the_most_reinforced(self):
        current = [{'id': f'L{i}', 'para': 'todos', 'texto': f'Lección número {i} con texto suficiente', 'refuerzos': i % 3, 'ultima': '2026-10-0' + str(1 + i % 5)} for i in range(1, 25)]
        out = equipo.merge_lessons(current, {})
        self.assertEqual(len(out), equipo.LESSON_CAP)
        self.assertTrue(all(l['refuerzos'] >= 1 for l in out[:10]) or len({l['refuerzos'] for l in out}) > 1)


class Metrics(unittest.TestCase):
    def test_counts_from_receipts(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            def receipt(tid, estado, ciclos):
                (state / 'runs' / tid).mkdir(parents=True)
                (state / 'runs' / tid / 'receipt.json').write_text(json.dumps({'tarea': tid, 'proyecto': 'owner-os', 'estado': estado, 'commit': 'abc' if estado == 'integrada' else None,
                    'inicio': equipo.now().isoformat(), 'fin': equipo.now().isoformat(), 'ciclos': ciclos}))
            ok, bad = {'prueba': 'tipos', 'ok': True}, {'prueba': 'tipos', 'ok': False}
            receipt('t_a', 'integrada', [{'pruebas': [ok], 'revision': {'decision': 'aprobar'}}])
            receipt('t_b', 'integrada', [{'pruebas': [bad]}, {'pruebas': [ok], 'revision': {'decision': 'aprobar'}}])
            receipt('t_c', 'bloqueada', [{'pruebas': [ok], 'revision': {'decision': 'cambios'}, 'fuera_de_alcance': ['x']}])
            with mock.patch.object(equipo, 'STATE', state), mock.patch.object(equipo, 'merged_by_owner', lambda pid, c: c[:1]):
                m = equipo.metrics('owner-os')
        self.assertEqual((m['tareas'], m['integradas'], m['a_la_primera'], m['bloqueadas']), (3, 2, 1, 1))
        self.assertEqual((m['cambios_pedidos'], m['pruebas_fallidas'], m['fuera_de_alcance'], m['fusionadas_por_ti']), (1, 1, 1, 1))
        self.assertEqual(m['decisiones_tuyas'], 0)
        self.assertIsNone(m['minutos_hasta_decision'])


    def test_uses_receipt_error_when_last_failure_error_is_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp); equipo.save(state / 'runs' / 't_1' / 'receipt.json', {'error': 'agotados los intentos: X'})
            with mock.patch.object(equipo, 'STATE', state):
                self.assertEqual(equipo.motivo_tarea_bloqueada({'id': 't_1', 'last_failure_error': ''}), 'agotados los intentos: X')

    def test_prefers_last_failure_error_over_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp); equipo.save(state / 'runs' / 't_1' / 'receipt.json', {'error': 'recibo'})
            with mock.patch.object(equipo, 'STATE', state):
                self.assertEqual(equipo.motivo_tarea_bloqueada({'id': 't_1', 'last_failure_error': 'tablero'}), 'tablero')

    def test_returns_empty_string_without_any_reason(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(equipo, 'STATE', Path(tmp)):
                self.assertEqual(equipo.motivo_tarea_bloqueada({'id': 't_1'}), '')

    def test_project_brief_uses_receipt_error_for_blocked_task(self):
        task = {'id': 't_1', 'title': 'Motor: bloqueada', 'status': 'blocked'}
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp); equipo.save(state / 'runs' / 't_1' / 'receipt.json', {'error': 'agotados los intentos: X'})
            with mock.patch.object(equipo, 'STATE', state), mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS', 'goal': 'g'}), \
                 mock.patch.object(equipo, 'tasks', lambda pid: [task]), mock.patch.object(equipo, 'metrics', lambda pid: {}), \
                 mock.patch.object(equipo, 'lessons', lambda pid: []), mock.patch.object(equipo, 'resultados', lambda pid: []), \
                 mock.patch.object(equipo, 'experimentos', lambda pid: {}), mock.patch.object(equipo, 'ficha', lambda pid: None):
                brief = equipo.project_brief('owner-os')
        self.assertEqual(brief['bloqueadas'], ['Motor: bloqueada: agotados los intentos: X'])

    def test_repeated_tests_are_counted(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            with mock.patch.object(equipo, 'STATE', state), mock.patch.object(equipo, 'merged_by_owner', lambda pid, c: []):
                self.assertEqual(equipo.metrics('owner-os')['repetidas'], 0)
                (state / 'runs' / 't_a').mkdir(parents=True)
                (state / 'runs' / 't_a' / 'receipt.json').write_text(json.dumps({'tarea': 't_a', 'proyecto': 'owner-os', 'estado': 'integrada', 'commit': 'abc',
                    'inicio': equipo.now().isoformat(), 'fin': equipo.now().isoformat(),
                    'ciclos': [{'pruebas': [{'prueba': 'demo', 'ok': True, 'repetida': True}, {'prueba': 'tipos', 'ok': True}]}]}))
                m = equipo.metrics('owner-os')
        self.assertEqual(m['repetidas'], 1)

    def test_decision_median_and_date_window(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            current = equipo.now()
            recent = (current - equipo.timedelta(days=2)).date().isoformat()
            old = (current - equipo.timedelta(days=8)).date().isoformat()
            decisions = [{'fecha': recent, 'titulo': f'Tarea {i}', 'decision': 'aprobada' if i != 1 else 'descartada', 'minutos': minutes}
                         for i, minutes in enumerate([2, 10, 30])]
            equipo.save(state / 'senales' / 'alfa.json', {'decisiones': decisions + [
                {'fecha': old, 'titulo': 'Antigua', 'decision': 'aprobada', 'minutos': 100}]})
            with mock.patch.object(equipo, 'STATE', state), mock.patch.object(equipo, 'now', return_value=current), \
                 mock.patch.object(equipo, 'merged_by_owner', return_value=[]):
                m = equipo.metrics('alfa')
                self.assertEqual((m['decisiones_tuyas'], m['minutos_hasta_decision']), (3, 10))
                m = equipo.metrics('alfa', days=1)
                self.assertEqual(m['decisiones_tuyas'], 0)
                self.assertIsNone(m['minutos_hasta_decision'])
                m = equipo.metrics('alfa', days=10)
                self.assertEqual((m['decisiones_tuyas'], m['minutos_hasta_decision']), (4, 20))

    def test_decision_median_split_by_launch_card(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            current = equipo.now()
            recent = current.date().isoformat()
            decision = lambda minutes, **k: {'fecha': recent, 'titulo': 'T', 'decision': 'aprobada', 'minutos': minutes, **k}
            with mock.patch.object(equipo, 'STATE', state), mock.patch.object(equipo, 'now', return_value=current), \
                 mock.patch.object(equipo, 'merged_by_owner', return_value=[]):
                m = equipo.metrics('alfa')
                self.assertEqual((m['minutos_hasta_decision_con_ficha'], m['minutos_hasta_decision_sin_ficha']), (None, None))
                self.assertEqual((m['decisiones_con_ficha'], m['decisiones_sin_ficha']), (0, 0))
                equipo.save(state / 'senales' / 'alfa.json', {'decisiones': [
                    decision(4, ficha=True), decision(7.5, ficha=True), decision(30, ficha=False), decision(10), decision(50, ficha=False)]})
                m = equipo.metrics('alfa')
                self.assertEqual((m['minutos_hasta_decision_con_ficha'], m['minutos_hasta_decision_sin_ficha']), (5.8, 30))
                self.assertEqual((m['decisiones_con_ficha'], m['decisiones_sin_ficha']), (2, 3))
                equipo.save(state / 'senales' / 'alfa.json', {'decisiones': [decision(3, ficha=True)]})
                m = equipo.metrics('alfa')
                self.assertEqual((m['minutos_hasta_decision_con_ficha'], m['minutos_hasta_decision_sin_ficha']), (3, None))
                self.assertEqual((m['decisiones_con_ficha'], m['decisiones_sin_ficha']), (1, 0))

    def test_planner_signals_decision_time_line(self):
        fake = {'tareas': 0, 'decisiones_tuyas': 1, 'minutos_hasta_decision_con_ficha': 3, 'minutos_hasta_decision_sin_ficha': None,
                'decisiones_con_ficha': 1, 'decisiones_sin_ficha': 0}
        with mock.patch.object(equipo, 'metrics', lambda pid, days=7: fake), mock.patch.object(equipo, 'lessons', lambda pid: []):
            self.assertIn('Tiempo de decisión de Owner: con ficha 3 min (n=1), sin ficha sin datos (n=0). Con menos de 5 por grupo no es señal.',
                          equipo.planner_signals('owner-os'))
            fake['decisiones_tuyas'] = 0
            self.assertNotIn('Tiempo de decisión de Owner', equipo.planner_signals('owner-os'))

    def test_planner_signals_decision_time_line_gives_a_signal_with_five_per_group(self):
        fake = {'tareas': 0, 'decisiones_tuyas': 10, 'minutos_hasta_decision_con_ficha': 3, 'minutos_hasta_decision_sin_ficha': 10,
                'decisiones_con_ficha': 5, 'decisiones_sin_ficha': 5}
        with mock.patch.object(equipo, 'metrics', lambda pid, days=7: fake), mock.patch.object(equipo, 'lessons', lambda pid: []):
            self.assertIn('con ficha decides más rápido que sin ficha', equipo.planner_signals('owner-os'))
            fake['decisiones_sin_ficha'] = 4
            signals = equipo.planner_signals('owner-os')
            self.assertIn('no es señal', signals)
            self.assertNotIn('decides más rápido', signals)


class Changes(unittest.TestCase):
    def test_first_status_line_keeps_its_path(self):
        """Regression: a stripped ' M lib/x.js' once became 'ib/x.js' and the real change was dropped."""
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            run = lambda *a: subprocess.run(['git', '-C', tmp, *a], check=True, capture_output=True)
            run('init', '-q'); (repo / 'lib').mkdir(); (repo / 'lib/x.js').write_text('a\n'); (repo / 'test.js').write_text('t\n')
            run('add', '.'); run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base')
            (repo / 'lib/x.js').write_text('b\n'); (repo / 'nuevo.js').write_text('n\n'); (repo / 'otro.js').write_text('o\n')
            (repo / 'node_modules').symlink_to(tmp)
            allowed, extra = equipo.changed(repo, ['lib/x.js', 'nuevo.js'], ['node_modules'])
        self.assertEqual(allowed, ['lib/x.js', 'nuevo.js'])
        self.assertEqual(extra, ['otro.js'])


class Worktree(unittest.TestCase):
    def test_dependency_links_stay_out_of_git_status_and_exclude_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as root:
            repo = Path(tmp)
            run = lambda *a: subprocess.run(['git', '-C', tmp, '-c', 'user.name=t', '-c', 'user.email=t@t', *a], check=True, capture_output=True, text=True).stdout.strip()
            run('init', '-q', '-b', 'main'); (repo / 'a.txt').write_text('a\n'); run('add', '.'); run('commit', '-qm', 'base')
            (repo / 'node_modules').mkdir(); (repo / 'node_modules/dep.js').write_text('d\n')
            env = {**os.environ, 'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@t', 'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@t'}
            cfg = {'repo': tmp, 'links': ['node_modules']}
            with mock.patch.object(equipo, 'project', lambda pid: cfg), mock.patch.object(equipo, 'ROOT', Path(root)), \
                 mock.patch.object(equipo, 'clean_env', lambda: env):
                equipo.worktree('x', 't', start='HEAD')
                path = equipo.worktree('x', 't', start='HEAD')
                self.assertTrue((path / 'node_modules').is_symlink())
                status = subprocess.run(['git', '-C', str(path), 'status', '--porcelain', '--untracked-files=all'], capture_output=True, text=True, env=env).stdout
                exclude = Path(run('rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'))
            self.assertEqual(status, '')
            self.assertEqual(exclude.read_text().splitlines().count('/node_modules'), 1)


class SyncBase(unittest.TestCase):
    def test_fast_forward_clean_merge_and_conflict(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            run = lambda *a: subprocess.run(['git', '-C', tmp, '-c', 'user.name=t', '-c', 'user.email=t@t', *a], check=True, capture_output=True, text=True).stdout.strip()
            run('init', '-q', '-b', 'main'); (repo / 'a.txt').write_text('a\n'); (repo / 'b.txt').write_text('b\n')
            run('add', '.'); run('commit', '-qm', 'base'); run('branch', 'equipo/x')
            cfg = {'repo': tmp, 'base': 'main'}
            env = {**os.environ, 'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@t', 'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@t'}
            with mock.patch.object(equipo, 'project', lambda pid: cfg), mock.patch.object(equipo, 'STATE', repo / 'state'), \
                 mock.patch.object(equipo, 'clean_env', lambda: env), mock.patch.object(equipo, 'post') as post:
                (repo / 'state').mkdir()
                self.assertEqual(equipo.sync_base('x'), 'al día')
                (repo / 'a.txt').write_text('a2\n'); run('commit', '-qam', 'owner 1')
                self.assertEqual(equipo.sync_base('x'), 'adelantada')
                self.assertEqual(run('rev-parse', 'equipo/x'), run('rev-parse', 'main'))
                run('checkout', '-q', 'equipo/x'); (repo / 'b.txt').write_text('b-team\n'); run('commit', '-qam', 'team'); run('checkout', '-q', 'main')
                (repo / 'c.txt').write_text('c\n'); run('add', 'c.txt'); run('commit', '-qm', 'owner 2')
                self.assertEqual(equipo.sync_base('x'), 'fusionada')
                self.assertEqual(run('show', 'equipo/x:b.txt'), 'b-team'); self.assertEqual(run('show', 'equipo/x:c.txt'), 'c')
                run('checkout', '-q', 'equipo/x'); (repo / 'a.txt').write_text('team-a\n'); run('commit', '-qam', 'team a'); run('checkout', '-q', 'main')
                (repo / 'a.txt').write_text('owner-a\n'); run('commit', '-qam', 'owner a')
                before = run('rev-parse', 'equipo/x')
                self.assertEqual(equipo.sync_base('x'), 'conflicto'); self.assertEqual(equipo.sync_base('x'), 'conflicto')
                self.assertEqual(run('rev-parse', 'equipo/x'), before)
                self.assertEqual(post.call_count, 1)
                self.assertIn('a.txt', post.call_args.args[2])

class Conflictos(unittest.TestCase):
    def test_lista_conflictos(self):
        self.assertEqual(equipo.lista_conflictos([]), '')
        self.assertEqual(equipo.lista_conflictos(['a.txt']), ' (en a.txt)')
        self.assertEqual(equipo.lista_conflictos(['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt', 'f.txt', 'g.txt']),
                         ' (en a.txt, b.txt, c.txt, d.txt, e.txt y 2 más)')

    def test_fusionar_project_conflict(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as root:
            repo = Path(tmp)
            run = lambda *a: subprocess.run(['git', '-C', tmp, '-c', 'user.name=t', '-c', 'user.email=t@t', *a], check=True, capture_output=True, text=True).stdout.strip()
            run('init', '-q', '-b', 'main'); (repo / 'a.txt').write_text('a\n')
            run('add', '.'); run('commit', '-qm', 'base'); run('branch', 'equipo/x')
            run('checkout', '-q', 'equipo/x'); (repo / 'a.txt').write_text('team-a\n'); run('commit', '-qam', 'team a'); run('checkout', '-q', 'main')
            (repo / 'a.txt').write_text('owner-a\n'); run('commit', '-qam', 'owner a')
            before = run('rev-parse', 'main')
            cfg = {'repo': tmp, 'base': 'main', 'tests': {}}
            env = {**os.environ, 'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@t', 'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@t'}
            with mock.patch.object(equipo, 'project', lambda pid: cfg), mock.patch.object(equipo, 'ROOT', Path(root)), \
                 mock.patch.object(equipo, 'STATE', Path(root) / 'state'), mock.patch.object(equipo, 'clean_env', lambda: env):
                result = equipo.fusionar_project('x')
            self.assertTrue(result.startswith('conflicto'))
            self.assertIn('a.txt', result)
            self.assertEqual(run('rev-parse', 'main'), before)
            self.assertFalse((Path(root) / 'worktrees' / 'x' / '_fusion').exists())

class Cartera(unittest.TestCase):
    def test_reads_project_notes_and_finds_the_team_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            (d / 'Huerto.md').write_text('---\ntipo: proyecto\nid: huerto\narea: social\nequipo: "alfa"\n---\n# Huerto\n\n## Contexto para el equipo\nUna app social.\n')
            (d / 'Suelta.md').write_text('# Una nota cualquiera sin propiedades\n')
            (d / 'Idea.md').write_text('---\ntipo: idea\n---\n# Idea\n')
            with mock.patch.object(equipo, 'CARTERA', d):
                self.assertEqual([n['nombre'] for n in equipo.cartera()], ['Huerto'])
                self.assertIn('Una app social.', equipo.ficha('alfa')['texto'])
                self.assertIsNone(equipo.ficha('otro'))
                self.assertEqual(equipo.cartera_resumen()[0]['area'], 'social')

class Models(unittest.TestCase):
    def setUp(self):
        patch = solo_claude(); patch.start(); self.addCleanup(patch.stop)

    def test_cheapest_model_that_fits(self):
        pick = equipo.pick_model
        self.assertEqual(pick('mesa'), ('claude-sonnet-5-5', 'low'))
        self.assertEqual(pick('planificador'), ('claude-opus-5-5', 'high'))
        self.assertEqual(pick('constructor', {'dificultad': 'baja'}), ('claude-sonnet-5-5', 'medium'))
        self.assertEqual(pick('constructor', {'dificultad': 'alta'})[0], 'claude-opus-5-5')
        self.assertEqual(pick('constructor', {'dificultad': 'baja', 'importante': 'toca package.json'})[0], 'claude-opus-5-5')
        self.assertEqual(pick('constructor', {'dificultad': 'baja'}, attempt=2)[0], 'claude-opus-5-5')
        self.assertEqual(pick('revisor', {'dificultad': 'media'}, diff_lines=900)[0], 'claude-opus-5-5')
        self.assertEqual(pick('revisor', {'dificultad': 'rara'})[0], 'claude-sonnet-5-5')        # unknown -> media
        self.assertEqual(pick(None), (equipo.CONFIG['model'], None))                            # no role: as before

    def test_planner_difficulty_is_kept_or_defaulted(self):
        ok = {'titulo': 'Una tarea', 'porque': 'x', 'detalle': 'Criterios de aceptación concretos', 'archivos': ['alfred-os/app/a.tsx'], 'pruebas': ['tipos'], 'depende_de': []}
        self.assertEqual(equipo.validate_task('owner-os', {**ok, 'dificultad': 'alta'}, 0)['dificultad'], 'alta')
        self.assertEqual(equipo.validate_task('owner-os', ok, 0)['dificultad'], 'media')

FAKE_CODEX = """#!/bin/sh
out=""
while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done
cat >/dev/null
echo "$*" >/dev/null
%s
"""
CODEX_OK = """printf 'Hecho.' > "$out"
echo '{"type":"thread.started"}'
echo '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":4,"output_tokens":5}}'"""
CODEX_DOWN = """echo '{"type":"error","message":"You have hit your usage limit"}'
exit 1"""
FAKE_CLAUDE = """#!/bin/sh
cat >/dev/null
echo '{"type":"rate_limit_event","rate_limit_info":{"unifiedWindows":{"five_hour":{"utilization":0.4,"resetsAt":1},"seven_day":{"utilization":0.2,"resetsAt":1}}}}'
echo '{"type":"result","result":"Claude hecho","total_cost_usd":0.01,"usage":{"output_tokens":3}}'
"""

@unittest.skipIf(os.name == 'nt', 'usa programas falsos de shell, que Windows no ejecuta')
class Codex(unittest.TestCase):
    """From 10/10 Codex builds first attempts by difficulty; Claude reviews, takes second attempts and covers outages."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); root = Path(self.tmp.name)
        self.codex = root / 'codex'; self.fake_claude = root / 'claude'
        self.fake_claude.write_text(FAKE_CLAUDE); self.fake_claude.chmod(0o755)
        self.patches = [mock.patch.object(equipo, 'STATE', root / 'state'), mock.patch.object(equipo, 'CODEX_BIN', self.codex),
                        mock.patch.object(equipo, 'claude_bin', lambda: str(self.fake_claude)), mock.patch.object(equipo, 'post', mock.Mock())]
        for patch in self.patches: patch.start()
        self.fake(CODEX_OK)

    def tearDown(self):
        for patch in self.patches: patch.stop()
        self.tmp.cleanup()

    def fake(self, body):
        self.codex.write_text(FAKE_CODEX % body); self.codex.chmod(0o755)

    def on(self, day, at='15:00'):
        moment = equipo.datetime.fromisoformat(f'{day}T{at}').replace(tzinfo=equipo.MADRID)
        return mock.patch.object(equipo, 'now', lambda: moment)

    def test_codex_takes_first_builds_from_its_date(self):
        pick = equipo.pick_model
        with self.on('2026-10-10', '09:00'):
            self.assertEqual(pick('constructor', {'dificultad': 'baja'}), ('claude-sonnet-5-5', 'medium'))   # credits back at 14:26
        with self.on('2026-10-10'):
            self.assertEqual(pick('constructor', {'dificultad': 'baja'}), ('gpt-5.6-terra', 'low'))
            self.assertEqual(pick('constructor', {'dificultad': 'media'}), ('gpt-6-astra', 'medium'))
            self.assertEqual(pick('constructor', {'dificultad': 'baja', 'importante': 'sensible'}), ('gpt-6-astra', 'high'))
            self.assertEqual(pick('constructor', {'dificultad': 'baja'}, attempt=2)[0], 'claude-opus-5-5')     # fresh eyes
            self.assertEqual(pick('revisor', {'dificultad': 'media'}, builder='gpt-6-astra')[0], 'claude-sonnet-5-5')   # Claude reviews Codex
            self.assertEqual(pick('revisor', {'dificultad': 'media'}, builder='claude-sonnet-5-5'), ('gpt-6-astra', 'medium'))  # and Codex reviews Claude
            self.assertEqual(pick('revisor', {'dificultad': 'baja'}, attempt=2, builder='claude-opus-5-5'), ('gpt-6-astra', 'high'))
            self.assertEqual(pick('revisor', {'dificultad': 'media'})[0], 'claude-sonnet-5-5')                          # builder unknown
            self.assertEqual(pick('revisor', {'dificultad': 'baja'})[0], 'claude-sonnet-5-5')                 # other vendor reviews
            self.assertEqual(pick('planificador'), ('claude-opus-5-5', 'high'))
            self.assertEqual(pick('constructor', {'dificultad': 'baja'}, codex=False)[0], 'claude-sonnet-5-5')
            equipo.save(equipo.STATE / 'codex.json', {'hasta': '2026-10-10 18:00'})
            self.assertEqual(pick('constructor', {'dificultad': 'baja'})[0], 'claude-sonnet-5-5')             # out for now
        with self.on('2026-10-10', '18:00'):
            self.assertEqual(pick('constructor', {'dificultad': 'baja'})[0], 'gpt-5.6-terra')                 # back when it said

    def test_codex_builds_and_logs_tokens(self):
        who = {}
        with self.on('2026-10-10'):
            answer = equipo.claude('Haz la tarea', self.tmp.name, 30, write=True, role='constructor', spec={'dificultad': 'baja'}, info=who)
            lines = (equipo.STATE / 'consumo' / '2026-10-10.jsonl').read_text().splitlines()
        self.assertEqual((answer, who['modelo']), ('Hecho.', 'gpt-5.6-terra'))
        line = json.loads(lines[-1])
        self.assertEqual((line['rol'], line['modelo'], line['tokens']['output_tokens']), ('constructor', 'gpt-5.6-terra', 5))

    def test_codex_outage_falls_back_to_claude_once_a_day(self):
        self.fake(CODEX_DOWN); who = {}; undo = mock.Mock()
        with self.on('2026-10-10'):
            answer = equipo.claude('Haz la tarea', self.tmp.name, 30, write=True, role='constructor', spec={'dificultad': 'baja'}, info=who, on_fallback=undo)
            again = equipo.pick_model('constructor', {'dificultad': 'baja'})[0]
            equipo.codex_down('otra vez')
        self.assertEqual((answer, who['modelo'], again), ('Claude hecho', 'claude-sonnet-5-5', 'claude-sonnet-5-5'))
        undo.assert_called_once()
        down = equipo.load(equipo.STATE / 'codex.json', {})
        self.assertEqual(down['hasta'], '2026-10-10 23:59')                                                  # no time given: rest of the day
        self.assertIn('usage limit', down['motivo'])
        equipo.post.assert_called_once()                                                                    # Owner hears it once

    def test_back_time_is_read_from_codex(self):
        with self.on('2026-10-05'):
            self.assertEqual(equipo.codex_back("You've hit your usage limit. Visit https://x to purchase more credits or try again at Oct 10th, 2026 2:26 PM."), '2026-10-10 14:26')
            self.assertEqual(equipo.codex_back('network error'), '2026-10-05 23:59')

    def test_status_line(self):
        with self.on('2026-10-09'): self.assertEqual(equipo.modelos_hoy(), {'codex': 'desde 2026-10-10 14:30'})
        with self.on('2026-10-10'): self.assertEqual(equipo.modelos_hoy()['codex'], 'activo')

class Salud(unittest.TestCase):
    """Silent failures must reach Owner: a problem seen twice is announced once, and its fix is announced too."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); root = Path(self.tmp.name)
        self.sent = []
        self.state = {'estado': 'ok'}
        fake = lambda: equipo._check('demo', 'Demo', self.state['estado'], 'detalle', 'haz esto')
        self.patches = [mock.patch.object(equipo, 'STATE', root / 'state'), mock.patch.object(equipo, 'SALUD', root / 'state' / 'salud.json'),
                        mock.patch.object(equipo, 'WORKSPACE', root / 'ws'), mock.patch.object(equipo, 'SALUD_CHECKS', [fake]),
                        mock.patch.object(equipo, 'alert', lambda title, text: self.sent.append(title))]
        for patch in self.patches: patch.start()

    def tearDown(self):
        for patch in self.patches: patch.stop()
        self.tmp.cleanup()

    def test_problem_twice_then_once_then_fixed(self):
        equipo.salud(); self.assertEqual(self.sent, [])                         # all fine: silence
        self.state['estado'] = 'fallo'
        equipo.salud(); self.assertEqual(self.sent, [])                         # seen once: could be a restart
        equipo.salud(); self.assertEqual(self.sent, ['⚠️ Demo'])                # seen twice: announced
        equipo.salud(); self.assertEqual(len(self.sent), 1)                     # never repeated
        self.state['estado'] = 'ok'
        out = equipo.salud(); self.assertEqual(self.sent[-1], '✅ Demo')        # the fix is announced
        self.assertEqual(out['resumen'], 'ok')

    def test_voice_without_key_is_a_failure(self):
        equipo.WORKSPACE.mkdir(parents=True)
        (equipo.WORKSPACE / 'voz.log').write_text('2026-10-05T18:11:42 clave: archivo bloqueado (macOS pide permiso para Documentos)\n')
        self.assertEqual(equipo.check_voz()['estado'], 'fallo')
        (equipo.WORKSPACE / 'voz.log').write_text('2026-10-05T18:31:09 clave: archivo del curso\n')
        self.assertEqual(equipo.check_voz()['estado'], 'ok')

    def test_plan_usage_levels(self):
        equipo.WORKSPACE.mkdir(parents=True)
        later = equipo.now().timestamp() + 3600
        write = lambda five: equipo.save(equipo.WORKSPACE / 'uso.json', {'fiveHour': five, 'sevenDay': 0.2, 'resetsAt': later, 'hora': equipo.now().isoformat()})
        write(0.5); self.assertEqual(equipo.check_uso()['estado'], 'ok')
        write(0.9); self.assertEqual(equipo.check_uso()['estado'], 'aviso')      # team braked
        write(0.98); self.assertEqual(equipo.check_uso()['estado'], 'fallo')     # Alfred at risk

    def test_brake(self):
        equipo.WORKSPACE.mkdir(parents=True)
        t = equipo.now().timestamp()
        equipo.save(equipo.STATE / 'uso.json', {'fiveHour': 0.99, 'sevenDay': 0.35, 'resetsAt': t + 3600, 'hora': equipo.now().isoformat()})
        self.assertIn('99 %', equipo.freno())
        equipo.save(equipo.STATE / 'uso.json', {'fiveHour': 0.99, 'sevenDay': 0.35, 'resetsAt': t - 60, 'hora': equipo.now().isoformat()})
        self.assertIsNone(equipo.freno())                                          # window already reset
        equipo.save(equipo.STATE / 'uso.json', {'fiveHour': 0.1, 'sevenDay': 0.9, 'hora': equipo.now().isoformat()})
        self.assertIn('semana', equipo.freno())
        # The freshest reading wins: Alfred saw it lower afterwards.
        equipo.save(equipo.WORKSPACE / 'uso.json', {'fiveHour': 0.1, 'sevenDay': 0.2, 'hora': (equipo.now() + equipo.timedelta(minutes=1)).isoformat()})
        self.assertIsNone(equipo.freno())

    def test_braked_run_and_deferred_plan(self):
        equipo.save(equipo.STATE / 'uso.json', {'fiveHour': 0.95, 'sevenDay': 0.2, 'resetsAt': equipo.now().timestamp() + 3600, 'hora': equipo.now().isoformat()})
        with mock.patch.object(equipo, 'ROOT', Path(self.tmp.name)), mock.patch.object(equipo, 'answer_owner') as answer, \
             mock.patch.object(equipo, 'retro') as retro:
            equipo.run_all()
            answer.assert_not_called()
            self.assertIn('aplazado', equipo.plan(['owner-os']))
            retro.assert_not_called()
        self.assertEqual(equipo.load(equipo.STATE / 'plan_aplazado.json', {})['fecha'], equipo.today())

    def test_stream_parsing(self):
        res, rate = equipo.parse_stream('basura\n{"type":"rate_limit_event","rate_limit_info":{"utilization":0.5}}\n{"type":"result","result":"OK"}\n')
        self.assertEqual((res['result'], rate['utilization']), ('OK', 0.5))

    def test_stuck_night_merge(self):
        equipo.save(equipo.STATE / 'fusiones' / 'ultima.json', {'fecha': '2026-10-05T23:47:53', 'resultados': {'beta': 'conflicto: necesita a Owner o a Hermes'}})
        with mock.patch.object(equipo, 'pending_merge', lambda pid: 3):
            self.assertEqual(equipo.check_fusiones()['estado'], 'fallo')
            equipo.save(equipo.STATE / 'fusiones' / 'ultima.json', {'fecha': '2026-10-05T23:47:53', 'resultados': {'beta': 'conflicto: necesita a Owner o a Hermes (en a.txt)'}})
            self.assertIn('a.txt', equipo.check_fusiones()['detalle'])
        with mock.patch.object(equipo, 'pending_merge', lambda pid: 0):            # resolved by hand since
            self.assertEqual(equipo.check_fusiones()['estado'], 'ok')

class Relaunch(unittest.TestCase):
    def test_relaunch_starts_from_what_blocked_it(self):
        prev = {'estado': 'bloqueada', 'ciclos': [{'revision': {'decision': 'cambios', 'motivos': 'Envuelve el fetch en el control de timedOut.'}}]}
        self.assertIn('timedOut', equipo.relaunch_note(prev))
        prev = {'estado': 'bloqueada', 'ciclos': [{'pruebas': [{'ok': False, 'salida': '400 !== 200'}]}]}
        self.assertIn('400 !== 200', equipo.relaunch_note(prev))
        self.assertEqual(equipo.relaunch_note({'estado': 'integrada'}), '')
        self.assertEqual(equipo.relaunch_note({}), '')

class FailureExcerpt(unittest.TestCase):
    def test_condensed_uses_first_600_failure_characters(self):
        failure = '✖ failing tests:' + ' detalle' * 200
        receipt = {'ciclos': [{'pruebas': [{'prueba': 'equipo', 'ok': False, 'salida': 'salida antigua', 'fallo': failure}]}]}
        output = equipo.condensed(receipt)
        self.assertEqual(output['ciclos'][0]['pruebas'][0]['salida'], failure[:600])
        self.assertTrue(output['ciclos'][0]['pruebas'][0]['salida'].startswith('✖ failing tests:'))

    def test_condensed_uses_output_tail_without_failure_excerpt(self):
        output_text = 'inicio' + 'x' * 500
        receipt = {'ciclos': [{'pruebas': [{'prueba': 'equipo', 'ok': False, 'salida': output_text}]}]}
        output = equipo.condensed(receipt)
        self.assertEqual(output['ciclos'][0]['pruebas'][0]['salida'], output_text[-300:])

    def test_condensed_keeps_passing_test_output_empty(self):
        receipt = {'ciclos': [{'pruebas': [{'prueba': 'equipo', 'ok': True, 'salida': 'todo correcto', 'fallo': 'no importa'}]}]}
        output = equipo.condensed(receipt)
        self.assertEqual(output['ciclos'][0]['pruebas'][0]['salida'], '')

    def test_node_keeps_failure_details_without_successes(self):
        out = ('✔ primera\n✖ suma\nℹ tests 2\n✖ failing tests:\n'
               'test at suma.test.js:12:3\n✖ suma\n  expected: 2\n  actual: 3\n  ✔ otra\n')
        excerpt = equipo.failure_excerpt(out)
        self.assertTrue(excerpt.startswith('✖ failing tests:'))
        self.assertIn('test at suma.test.js:12:3', excerpt)
        self.assertIn('expected: 2', excerpt)
        self.assertIn('actual: 3', excerpt)
        self.assertNotIn('✔', excerpt)
        self.assertEqual(equipo.failure_excerpt(out, 30), excerpt[:30])

    def test_unittest_keeps_failure_block(self):
        out = '✔ previa\n.F\n======\nFAIL: test_suma\nTraceback:\nAssertionError: 3 != 2\n  ✔ otra\n'
        excerpt = equipo.failure_excerpt(out)
        self.assertTrue(excerpt.startswith('======'))
        self.assertIn('FAIL: test_suma', excerpt)
        self.assertIn('AssertionError: 3 != 2', excerpt)
        self.assertNotIn('✔', excerpt)

    def test_tsc_keeps_error_lines(self):
        out = 'Compilando\n  ✔ previa\napp.ts(1,1): error TS2322: incompatible\nERROR: otro fallo\nFin\n'
        excerpt = equipo.failure_excerpt(out)
        self.assertEqual(excerpt, 'app.ts(1,1): error TS2322: incompatible\nERROR: otro fallo\n')
        self.assertNotIn('✔', excerpt)

    def test_fallback_keeps_tail_without_successes(self):
        self.assertEqual(equipo.failure_excerpt('inicio\n  ✔ previa\nfinal', 8), 'io\nfinal')
        self.assertEqual(equipo.failure_excerpt('error', 0), '')

    def test_run_tests_extracts_before_truncating_output(self):
        out = '✖ failing tests:\nexpected: 2\nactual: 3\n' + 'detalle\n' * 500
        with mock.patch.object(equipo, 'project', lambda pid: {'tests': {'tipos': {'cmd': ['tsc']}}}), \
             mock.patch.object(equipo, 'run', lambda *a, **kw: (1, out)):
            results = equipo.run_tests('owner-os', {'pruebas': ['tipos']}, Path('/tmp'), Path('/tmp'), None)
        self.assertEqual(results[0]['salida'], out[-1500:])
        self.assertEqual(results[0]['fallo'], out[:3000])
        self.assertFalse(results[0]['ok'])

    def test_relaunch_prefers_failure_excerpt(self):
        prev = {'estado': 'bloqueada', 'ciclos': [{'pruebas': [{'ok': False, 'salida': '...', 'fallo': 'BLOQUE-FALLO'}]}]}
        self.assertIn('BLOQUE-FALLO', equipo.relaunch_note(prev))

    def test_attempts_passes_failure_excerpt_to_retry_and_stop(self):
        prompts = []
        def claude(*a, **kw):
            prompts.append(a[0]); return 'hecho'
        spec = {'titulo': 'x', 'archivos': ['alfred-os/app/board.tsx'], 'pruebas': ['tipos']}
        receipt = {'ciclos': []}
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.dict(equipo.LIMITS, {'attempts': 2}), \
             mock.patch.object(equipo, 'claude', claude), \
             mock.patch.object(equipo, 'changed', lambda *a, **kw: (['alfred-os/app/board.tsx'], [])), \
             mock.patch.object(equipo, 'run_tests', lambda *a, **kw: [{'ok': False, 'salida': '...', 'fallo': 'BLOQUE-FALLO'}]), \
             mock.patch.object(equipo, 'phase', lambda *a, **kw: None), \
             mock.patch.object(equipo, 'lessons_text', lambda *a, **kw: ''), \
             mock.patch.object(equipo, 'context_text', lambda *a, **kw: ''), \
             mock.patch.object(equipo, 'discard', lambda *a, **kw: None), \
             mock.patch.object(equipo, 'log', lambda *a, **kw: None):
            with self.assertRaises(equipo.Stop) as ctx:
                equipo.attempts('owner-os', {'name': 'Owner OS'}, spec, {'id': 't_1'}, 'equipo/owner-os', 'b', Path(tmp), Path(tmp), receipt, None)
        self.assertEqual(len(prompts), 2)
        self.assertIn('BLOQUE-FALLO', prompts[1])
        self.assertEqual(str(ctx.exception), 'agotados los intentos: BLOQUE-FALLO')

NET_FAKE_CLAUDE = """#!/bin/sh
cat >/dev/null
n=$(cat COUNTER 2>/dev/null || echo 0)
echo $((n + 1)) > COUNTER
if [ "$n" -lt FAILS ]; then
  echo '{"type":"result","is_error":true,"result":"MESSAGE"}'
  exit 1
fi
echo '{"type":"result","result":"Claude hecho","total_cost_usd":0.01,"usage":{"output_tokens":3}}'
"""
NET_DOWN = "API Error: Can't reach the API server (ENOTFOUND)"

@unittest.skipIf(os.name == 'nt', 'usa programas falsos de shell, que Windows no ejecuta')
class NetworkRetry(unittest.TestCase):
    """A network error from Claude Code is retried with a wait; any other error stops at once."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); root = Path(self.tmp.name)
        self.counter = root / 'COUNTER'; self.fake_claude = root / 'claude'
        self.patches = [mock.patch.object(equipo, 'STATE', root / 'state'), mock.patch.object(equipo, 'NET_WAITS', (0, 0)),
                        mock.patch.object(equipo, 'claude_bin', lambda: str(self.fake_claude))]
        for patch in self.patches: patch.start()

    def tearDown(self):
        for patch in self.patches: patch.stop()
        self.tmp.cleanup()

    def fake(self, fails, message):
        script = NET_FAKE_CLAUDE.replace('COUNTER', str(self.counter)).replace('FAILS', str(fails)).replace('MESSAGE', message.replace("'", "'\\''"))
        self.fake_claude.write_text(script); self.fake_claude.chmod(0o755)

    def calls(self): return int(self.counter.read_text())

    def test_one_network_failure_is_retried(self):
        self.fake(1, NET_DOWN)
        self.assertEqual(equipo.claude('Haz la tarea', self.tmp.name, 30), 'Claude hecho')
        self.assertEqual(self.calls(), 2)
        self.assertEqual(len((equipo.STATE / 'consumo' / f'{equipo.today()}.jsonl').read_text().splitlines()), 2)   # each attempt is logged

    def test_a_network_that_never_comes_back_blocks_with_its_reason(self):
        self.fake(99, NET_DOWN)
        with self.assertRaises(equipo.Stop) as ctx: equipo.claude('Haz la tarea', self.tmp.name, 30)
        self.assertTrue(str(ctx.exception).startswith('API inaccesible'))
        self.assertEqual(self.calls(), 3)

    def test_other_errors_are_not_retried(self):
        self.fake(99, 'Invalid API key')
        with self.assertRaises(equipo.Stop) as ctx: equipo.claude('Haz la tarea', self.tmp.name, 30)
        self.assertTrue(str(ctx.exception).startswith('claude_error: '))
        self.assertEqual(self.calls(), 1)

    def test_a_lost_claim_while_waiting_stops(self):
        self.fake(99, NET_DOWN)
        idle = lambda: bool(equipo.CHILDREN)    # alive while Claude runs, lost during the wait
        with mock.patch.object(equipo, 'NET_WAITS', (1,)):
            with self.assertRaises(equipo.Stop) as ctx: equipo.claude('Haz la tarea', self.tmp.name, 30, heartbeat=idle)
        self.assertEqual(str(ctx.exception), 'claim_lost')
        self.assertEqual(self.calls(), 1)

class TimeoutRetry(unittest.TestCase):
    def test_one_timeout_is_retried_with_more_time(self):
        seen = []
        def call(seconds, note=''):
            seen.append(seconds)
            if len(seen) == 1: raise equipo.Stop('timeout')
            return 'hecho'
        self.assertEqual(equipo.retry_timeout(call, 900), 'hecho')
        self.assertEqual(seen, [900, 1350])

    def test_retry_carries_a_note_about_unfinished_work(self):
        notes = []
        def call(seconds, note=''):
            notes.append(note)
            if len(notes) == 1: raise equipo.Stop('timeout')
            return 'hecho'
        equipo.retry_timeout(call, 900, 'owner-os', 't_1')
        self.assertEqual(notes[0], '')
        self.assertTrue(notes[1])

    def test_two_timeouts_say_the_builder_timed_out(self):
        def call(seconds, note=''): raise equipo.Stop('timeout')
        with self.assertRaises(equipo.Stop) as ctx: equipo.retry_timeout(call, 900)
        self.assertIn('timeout al construir', str(ctx.exception))
        self.assertIn('1350', str(ctx.exception))

    def test_without_retry_a_timeout_is_one_call_and_names_the_phase(self):
        calls = []
        def call(seconds, note=''):
            calls.append(seconds); raise equipo.Stop('timeout')
        with self.assertRaises(equipo.Stop) as ctx: equipo.retry_timeout(call, 900, retry=False)
        self.assertEqual(calls, [900])
        self.assertIn('timeout al construir', str(ctx.exception))
        self.assertIn('900', str(ctx.exception))

    def test_other_stops_are_not_retried(self):
        calls = []
        def call(seconds, note=''):
            calls.append(seconds); raise equipo.Stop('claim_lost')
        with self.assertRaises(equipo.Stop) as ctx: equipo.retry_timeout(call, 900)
        self.assertEqual(str(ctx.exception), 'claim_lost')
        self.assertEqual(calls, [900])

    def test_attempts_does_not_retry_a_timeout_in_attempt_two(self):
        if equipo.LIMITS['attempts'] < 2: self.skipTest('hace falta más de un intento')
        calls = []
        def claude(*a, **kw):
            calls.append(kw.get('attempt'))
            if len(calls) == 1: return 'hecho'
            raise equipo.Stop('timeout')
        spec = {'titulo': 'x', 'archivos': ['alfred-os/app/board.tsx'], 'pruebas': ['tipos']}
        receipt = {'ciclos': []}
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(equipo, 'claude', claude), \
             mock.patch.object(equipo, 'changed', lambda *a, **kw: (['alfred-os/app/board.tsx'], [])), \
             mock.patch.object(equipo, 'run_tests', lambda *a, **kw: [{'prueba': 'tipos', 'ok': False, 'salida': 'fallo'}]), \
             mock.patch.object(equipo, 'phase', lambda *a, **kw: None), \
             mock.patch.object(equipo, 'lessons_text', lambda *a, **kw: ''), \
             mock.patch.object(equipo, 'context_text', lambda *a, **kw: ''), \
             mock.patch.object(equipo, 'discard', lambda *a, **kw: None), \
             mock.patch.object(equipo, 'log', lambda *a, **kw: None):
            with self.assertRaises(equipo.Stop) as ctx:
                equipo.attempts('owner-os', {'name': 'Owner OS'}, spec, {'id': 't_1'}, 'equipo/owner-os', 'b', Path(tmp), Path(tmp), receipt, None)
        seconds = equipo.LIMITS['builder_seconds']
        self.assertIn('timeout al construir', str(ctx.exception))
        self.assertIn(str(seconds), str(ctx.exception))
        self.assertNotIn(str(int(seconds * 1.5)), str(ctx.exception))
        self.assertEqual(len(calls), 2)
        self.assertEqual(len(receipt['ciclos']), 1)
        self.assertEqual(receipt['ciclos'][0]['intento'], 1)
        self.assertFalse(all(t['ok'] for t in receipt['ciclos'][0]['pruebas']))

    def test_run_tests_timeout_names_the_test(self):
        def slow(*a, **kw): raise equipo.Stop('timeout')
        with mock.patch.object(equipo, 'project', lambda pid: {'tests': {'tipos': {'cmd': ['tsc']}}}), \
             mock.patch.object(equipo, 'run', slow):
            with self.assertRaises(equipo.Stop) as ctx:
                equipo.run_tests('owner-os', {'pruebas': ['tipos']}, Path('/tmp'), Path('/tmp'), None)
        self.assertIn('timeout al probar tipos', str(ctx.exception))
        self.assertIn(str(equipo.LIMITS['test_seconds']), str(ctx.exception))

    def test_run_tests_lets_other_stops_through(self):
        def lost(*a, **kw): raise equipo.Stop('claim_lost')
        with mock.patch.object(equipo, 'project', lambda pid: {'tests': {'tipos': {'cmd': ['tsc']}}}), \
             mock.patch.object(equipo, 'run', lost):
            with self.assertRaises(equipo.Stop) as ctx:
                equipo.run_tests('owner-os', {'pruebas': ['tipos']}, Path('/tmp'), Path('/tmp'), None)
        self.assertEqual(str(ctx.exception), 'claim_lost')

    def test_attempts_test_timeout_leaves_its_cycle_in_the_receipt(self):
        def slow(*a, **kw): raise equipo.Stop(f"timeout al probar tipos ({equipo.LIMITS['test_seconds']} s)")
        spec = {'titulo': 'x', 'archivos': ['alfred-os/app/board.tsx'], 'pruebas': ['tipos']}
        receipt = {'ciclos': []}
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(equipo, 'claude', lambda *a, **kw: 'hecho'), \
             mock.patch.object(equipo, 'changed', lambda *a, **kw: (['alfred-os/app/board.tsx'], [])), \
             mock.patch.object(equipo, 'run_tests', slow), \
             mock.patch.object(equipo, 'phase', lambda *a, **kw: None), \
             mock.patch.object(equipo, 'lessons_text', lambda *a, **kw: ''), \
             mock.patch.object(equipo, 'context_text', lambda *a, **kw: ''), \
             mock.patch.object(equipo, 'discard', lambda *a, **kw: None), \
             mock.patch.object(equipo, 'log', lambda *a, **kw: None):
            with self.assertRaises(equipo.Stop) as ctx:
                equipo.attempts('owner-os', {'name': 'Owner OS'}, spec, {'id': 't_1'}, 'equipo/owner-os', 'b', Path(tmp), Path(tmp), receipt, None)
        self.assertIn('timeout al probar', str(ctx.exception))
        self.assertEqual(len(receipt['ciclos']), 1)
        self.assertEqual(receipt['ciclos'][-1]['intento'], 1)
        self.assertEqual(receipt['ciclos'][-1]['pruebas'], [{'prueba': 'tipos', 'ok': False, 'timeout': True}])

    def test_relaunch_after_a_test_timeout_uses_the_block_reason(self):
        prev = {'estado': 'bloqueada', 'error': 'timeout al probar tipos (600 s)',
                'ciclos': [{'pruebas': [{'prueba': 'tipos', 'ok': False, 'timeout': True}]}]}
        self.assertIn('timeout al probar tipos', equipo.relaunch_note(prev))

    def test_attempts_review_timeout_names_the_phase(self):
        calls = []
        def claude(*a, **kw):
            calls.append(kw.get('role'))
            if kw.get('role') == 'constructor': return 'hecho'
            raise equipo.Stop('timeout')
        spec = {'titulo': 'x', 'archivos': ['alfred-os/app/board.tsx'], 'pruebas': ['tipos']}
        receipt = {'ciclos': []}
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(equipo, 'claude', claude), \
             mock.patch.object(equipo, 'git', lambda *a, **kw: ''), \
             mock.patch.object(equipo, 'changed', lambda *a, **kw: (['alfred-os/app/board.tsx'], [])), \
             mock.patch.object(equipo, 'run_tests', lambda *a, **kw: [{'prueba': 'tipos', 'ok': True, 'salida': ''}]), \
             mock.patch.object(equipo, 'phase', lambda *a, **kw: None), \
             mock.patch.object(equipo, 'lessons_text', lambda *a, **kw: ''), \
             mock.patch.object(equipo, 'context_text', lambda *a, **kw: ''), \
             mock.patch.object(equipo, 'discard', lambda *a, **kw: None), \
             mock.patch.object(equipo, 'log', lambda *a, **kw: None):
            with self.assertRaises(equipo.Stop) as ctx:
                equipo.attempts('owner-os', {'name': 'Owner OS'}, spec, {'id': 't_1'}, 'equipo/owner-os', 'b', Path(tmp), Path(tmp), receipt, None)
        self.assertIn('timeout al revisar', str(ctx.exception))
        self.assertIn(str(equipo.LIMITS['review_seconds']), str(ctx.exception))
        self.assertEqual(calls.count('constructor'), 1)
        self.assertEqual(calls.count('revisor'), 1)
        self.assertEqual(receipt['ciclos'], [])

class PlanDuplicates(unittest.TestCase):
    BOARD = [{'id': 't_a', 'title': 'Entregas: lista A', 'status': 'done'}, {'id': 't_b', 'title': 'Motor: B', 'status': 'ready'},
             {'id': 't_c', 'title': 'Motor: C', 'status': 'blocked'}, {'id': 't_d', 'title': 'D', 'status': 'archived'}]

    def items(self, *specs):
        return [{'titulo': t, 'depende_de': deps} for t, deps in specs]

    def test_board_and_batch_duplicates_are_dropped(self):
        items = self.items(('entregas: lista a ', []), ('Motor: C', []), ('D', []), ('E', []), ('E.', []), ('F', [0]))
        kept, dropped = equipo.drop_duplicates(items, self.BOARD)
        self.assertEqual([t['titulo'] for t in kept], ['Motor: C', 'D', 'E'])
        self.assertEqual(dropped, [{'titulo': 'entregas: lista a ', 'duplicada_de': 't_a'},
                                   {'titulo': 'E.', 'duplicada_de': 'el mismo lote'},
                                   {'titulo': 'F', 'duplicada_de': 'depende de una duplicada'}])

    def test_depende_de_is_renumbered_for_the_kept_ones(self):
        items = self.items(('Motor: B…', []), ('Motor: C', []), ('D', [1]), ('E', []), ('G', [1, 3]))
        kept, dropped = equipo.drop_duplicates(items, self.BOARD)
        self.assertEqual([(t['titulo'], t['depende_de']) for t in kept], [('Motor: C', []), ('D', [0]), ('E', []), ('G', [0, 2])])
        self.assertEqual(dropped, [{'titulo': 'Motor: B…', 'duplicada_de': 't_b'}])

    def test_nothing_to_drop_keeps_everything(self):
        items = self.items(('X', []), ('Y', [0]))
        kept, dropped = equipo.drop_duplicates(items, [])
        self.assertEqual(kept, items)
        self.assertEqual(dropped, [])

class PlanProjectWiring(unittest.TestCase):
    """plan_project wires drop_duplicates: an empty batch says why, and a kept one carries no motivo."""
    BOARD = [{'id': 't_a', 'title': 'Motor: A', 'status': 'done'}]

    def plan(self, titles):
        proposals = [{'titulo': t, 'archivos': ['equipo/equipo.py'], 'pruebas': ['equipo']} for t in titles]
        answer = 'Propuesta:\n```json\n' + json.dumps(proposals, ensure_ascii=False) + '\n```'
        messages = []
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(equipo, 'STATE', Path(tmp)), \
             mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS', 'goal': 'g', 'tests': ['equipo'], 'repo': '/tmp/x'}), \
             mock.patch.object(equipo, 'git', lambda *a, **kw: 'abc'), \
             mock.patch.object(equipo, 'worktree', lambda *a, **kw: Path(tmp)), \
             mock.patch.object(equipo, 'tasks', lambda pid: self.BOARD), \
             mock.patch.object(equipo, 'claude', lambda *a, **kw: answer), \
             mock.patch.object(equipo, 'validate_task', lambda pid, t, i: {**t, 'depende_de': t.get('depende_de', [])}), \
             mock.patch.object(equipo, 'context_text', lambda *a, **kw: ''), \
             mock.patch.object(equipo, 'planner_signals', lambda *a, **kw: ''), \
             mock.patch.object(equipo, 'log', lambda *a, **kw: messages.append(' '.join(str(p) for p in a))):
            file = Path(tmp) / 'proposals' / f'{equipo.today()}.json'
            batch = {'fecha': equipo.today(), 'proyectos': {}}
            entry = equipo.plan_project('owner-os', batch, file)
            saved = json.loads(file.read_text())
        self.assertEqual(saved['proyectos']['owner-os'], entry)
        return entry, messages

    def test_everything_repeated_says_why_the_batch_is_empty(self):
        entry, messages = self.plan(['Motor: A'])
        self.assertEqual(entry['estado'], 'sin propuestas')
        self.assertIn('ya estaba en el tablero', entry['motivo'])
        self.assertEqual(len(entry['duplicadas']), 1)
        self.assertTrue(any('lote vacío' in m for m in messages))

    def test_some_repeated_keeps_the_rest_without_motivo(self):
        entry, messages = self.plan(['Motor: A', 'Motor: B'])
        self.assertEqual(entry['estado'], 'pendiente')
        self.assertEqual([t['titulo'] for t in entry['tareas']], ['Motor: B'])
        self.assertNotIn('motivo', entry)
        self.assertEqual(len(entry['duplicadas']), 1)
        self.assertFalse(any('lote vacío' in m for m in messages))

    def test_planner_proposing_nothing_has_no_motivo(self):
        entry, messages = self.plan([])
        self.assertEqual(entry['estado'], 'sin propuestas')
        self.assertNotIn('motivo', entry)
        self.assertNotIn('duplicadas', entry)
        self.assertFalse(any('lote vacío' in m for m in messages))

class Encargos(unittest.TestCase):
    """Alfred's encargo goes the same road as an approved batch: valid spec, ledger hash, team board, notice at the end."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); root = Path(self.tmp.name)
        from contextlib import contextmanager
        @contextmanager
        def fake_board(pid): yield None
        self.created = []
        def create(conn, **kw): self.created.append(kw); return 't_encargo1'
        self.sent = []
        self.patches = [mock.patch.object(equipo, 'STATE', root / 'state'), mock.patch.object(equipo, 'ENCARGOS', root / 'state' / 'encargos.json'),
                        mock.patch.object(equipo, 'board', fake_board), mock.patch.object(equipo.kb, 'create_task', create),
                        mock.patch.object(equipo, 'freno', lambda: None), mock.patch.object(equipo, 'telegram', lambda t, botones=None: self.sent.append(t)),
                        solo_claude()]
        for patch in self.patches: patch.start()

    def tearDown(self):
        for patch in self.patches: patch.stop()
        self.tmp.cleanup()

    def task(self, **kw):
        return {'titulo': 'Lista de espera: evitar el envío doble', 'porque': 'Owner lo pidió por Telegram',
                'detalle': 'El botón se desactiva mientras se envía; prueba que un segundo clic no envía dos veces.',
                'archivos': ['alfred-os/app/board.tsx'], 'pruebas': ['tipos'], 'dificultad': 'baja', **kw}

    @mock.patch.object(equipo, 'codex_ready', lambda: False)
    def test_encargo_is_approved_work_for_the_team(self):
        out = equipo.encargar('owner-os', self.task())
        self.assertEqual((out['tarea'], self.created[0]['priority'], self.created[0]['assignee']), ('t_encargo1', 10, equipo.LANE))
        spec = equipo.spec_of('owner-os', {'id': 't_encargo1', 'body': self.created[0]['body']})       # passes the ledger check
        self.assertEqual((spec['origen'], spec['depende_de']), ('alfred', []))
        self.assertEqual(out['constructor'], 'claude-sonnet-5-5')
        equipo.avisar_encargo({'id': 't_encargo1'}, 'hecha', 'Integrada en equipo/owner-os (abc).')
        equipo.avisar_encargo({'id': 'otra'}, 'hecha', 'no es un encargo')
        self.assertEqual(len(self.sent), 1); self.assertIn('evitar el envío doble', self.sent[0])

    def test_bad_encargo_is_refused(self):
        with self.assertRaises(equipo.Stop): equipo.encargar('inventado', self.task())
        with self.assertRaises(equipo.Stop): equipo.encargar('owner-os', self.task(archivos=['../fuera']))
        with self.assertRaises(equipo.Stop): equipo.encargar('owner-os', self.task(pruebas=['rm -rf /']))
        self.assertEqual(self.created, [])

class Answered(unittest.TestCase):
    def test_linked_and_legacy_replies_count(self):
        msgs = [{'id': 'M1', 'de': 'control', 'para': ['owner'], 'texto': '¿Aceptas?'},
                {'id': 'M2', 'de': 'owner', 'para': ['control'], 'texto': 'Sobre M1: acepto'},
                {'id': 'M3', 'de': 'product', 'para': ['owner'], 'texto': '¿Y esto?'},
                {'id': 'M4', 'de': 'owner', 'para': ['product'], 'texto': 'sí', 'responde_a': 'M3'},
                {'id': 'M5', 'de': 'business', 'para': ['owner'], 'texto': '¿Precio?'},
                {'id': 'M6', 'de': 'control', 'para': ['owner'], 'texto': 'Sobre M5: no soy Owner'}]
        self.assertEqual(equipo.answered_by_owner(msgs), {'M1', 'M3'})

class Mesa(unittest.TestCase):
    def test_messages_are_validated_and_numbered(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(equipo, 'STATE', Path(tmp)):
                (Path(tmp) / 'mesa').mkdir()
                a = equipo.post('business', ['studio', 'nadie'], 'Para la afiliación necesitamos una página de condiciones.', 'pregunta', 'beta', origen='mesa')
                b = equipo.post('studio', ['business'], 'La preparo con el tono de la marca.', 'inventado', 'proyecto-falso', responde_a='M1')
                self.assertIsNone(equipo.post('intruso', ['todos'], 'hola'))
                self.assertIsNone(equipo.post('owner', ['todos'], '   '))
                saved = equipo.mesa_load()['mensajes']
        self.assertEqual((a['id'], a['para'], a['proyecto']), ('M1', ['studio'], 'beta'))
        self.assertEqual((b['id'], b['tipo'], b['proyecto'], b['responde_a']), ('M2', 'aviso', 'general', 'M1'))
        self.assertEqual(len(saved), 2)
        self.assertIn('Negocio → Creativo', equipo.transcript(saved))


class Notices(unittest.TestCase):
    def test_telegram_notices_are_one_short_sentence(self):
        self.assertEqual(equipo.first_sentence('Hecho el cambio. Además he revisado tres cosas más que...'), 'Hecho el cambio.')
        long = 'palabra ' * 60
        self.assertTrue(len(equipo.first_sentence(long)) <= 160 and equipo.first_sentence(long).endswith('…'))
        sent = []
        with mock.patch.object(equipo.subprocess, 'run'), mock.patch.object(equipo, 'telegram', sent.append):
            equipo.notify('Alfa: ronda 2', 'en marcha, 3 tareas · 1 espera tu OK → /lote')
        self.assertEqual(sent, ['Alfa: ronda 2: en marcha, 3 tareas · 1 espera tu OK → /lote'])

class HoyManana(unittest.TestCase):
    """Today's to-do goes out from the team's service when the app is closed, once, with the same file and buttons."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); root = Path(self.tmp.name)
        self.ws = root / 'ws'; (self.ws).mkdir(); (root / 'state' / 'mesa').mkdir(parents=True)
        (self.ws / 'telegram.json').write_text(json.dumps({'chatId': 42}))
        self.sent = []; self.answer = '- Aprobar el lote de TF\n- Sol 10 min\n- Llamar al gestor'
        def send(text, markup=None): self.sent.append((text, markup)); return 100 + len(self.sent)
        self.patches = [mock.patch.object(equipo, 'WORKSPACE', self.ws), mock.patch.object(equipo, 'TELEGRAM_LINK', self.ws / 'telegram.json'),
                        mock.patch.object(equipo, 'STATE', root / 'state'), mock.patch.object(equipo, 'telegram_send', send),
                        mock.patch.object(equipo, 'app_abierta', lambda: False), mock.patch.object(equipo, 'freno', lambda: None),
                        mock.patch.object(equipo, 'pending_merge', lambda pid: 0), mock.patch.object(equipo, 'VAULT', root / 'vault'),
                        mock.patch.object(equipo, 'claude', lambda prompt, *a, **k: self.answer), mock.patch.object(equipo, 'tablero', lambda: self.board)]
        self.board = []
        for p in self.patches: p.start()
        self.at = equipo.now().replace(hour=10, minute=0, second=0, microsecond=0)

    def tearDown(self):
        for p in self.patches: p.stop()
        self.tmp.cleanup()

    def day(self): return json.loads((self.ws / 'hoy' / f'{self.at.date().isoformat()}.json').read_text())

    def test_sends_once_with_a_button_per_task(self):
        self.assertEqual(equipo.hoy_manana(self.at), ['Aprobar el lote de TF', 'Sol 10 min', 'Llamar al gestor'])
        text, markup = self.sent[0]
        self.assertTrue(text.startswith('Hoy, ') and '○ Sol 10 min' in text)
        self.assertEqual(markup['inline_keyboard'][0][0]['callback_data'], f'h:{self.at.date().isoformat()}:0')
        self.assertEqual((self.day()['mensaje'], len(self.day()['items'])), (101, 3))
        self.assertIsNone(equipo.hoy_manana(self.at)); self.assertEqual(len(self.sent), 1)

    def test_not_with_the_app_open_too_early_or_too_late(self):
        with mock.patch.object(equipo, 'app_abierta', lambda: True): self.assertIsNone(equipo.hoy_manana(self.at))
        self.assertIsNone(equipo.hoy_manana(self.at.replace(hour=8)))
        self.assertIsNone(equipo.hoy_manana(self.at.replace(hour=21)))
        self.assertEqual(self.sent, [])

    def test_without_alfred_the_decisions_and_yesterday_come_first(self):
        y = (self.at - equipo.timedelta(days=1)).date().isoformat(); (self.ws / 'hoy').mkdir()
        (self.ws / 'hoy' / f'{y}.json').write_text(json.dumps({'fecha': y, 'items': [{'t': 'Llamar al gestor', 'hecho': False}, {'t': 'Hecha', 'hecho': True}]}))
        self.answer = 'No puedo.'
        self.assertEqual(equipo.hoy_manana(self.at), ['Llamar al gestor'])
        self.assertIn('respaldo', (self.ws / 'hoy' / 'registro.log').read_text())

    def test_due_cards_bring_the_review_invitation(self):
        (self.ws / 'repaso').mkdir(); (self.ws / 'repaso' / 'tarjetas.json').write_text(json.dumps([{'due': '2026-01-01'}, {'due': '2099-01-01'}]))
        equipo.hoy_manana(self.at)
        self.assertEqual(self.sent[1][0], 'Repaso de hoy: 1 tarjeta (2 min).')
        self.assertEqual(self.sent[1][1]['inline_keyboard'][0][0]['callback_data'], 'r:s')

    def test_a_failed_send_leaves_no_file_so_it_retries(self):
        with mock.patch.object(equipo, 'telegram_send', lambda *a, **k: None): self.assertIsNone(equipo.hoy_manana(self.at))
        self.assertFalse((self.ws / 'hoy' / f'{self.at.date().isoformat()}.json').exists())

    def test_decisions_name_experiments_batches_and_real_questions(self):
        self.board = [{'fase': 'lista para lanzar'}, {'fase': 'lista para lanzar · falta fusionar'}, {'fase': 'falta medir'}]
        equipo.save(equipo.STATE / 'proposals' / f'{equipo.today()}.json', {'proyectos': {'alfa': {'estado': 'pendiente', 'tareas': [{}, {}]}}})
        equipo.save(equipo.STATE / 'mesa' / f'{equipo.today()}.json', {'mensajes': [
            {'id': 'M1', 'de': 'radar', 'para': ['owner'], 'tipo': 'aviso', 'texto': 'x'},
            {'id': 'M2', 'de': 'product', 'para': ['owner'], 'tipo': 'pregunta', 'texto': '¿Sí?'},
            {'id': 'M3', 'de': 'studio', 'para': ['owner'], 'tipo': 'pregunta', 'texto': '¿Y?'},
            {'id': 'M4', 'de': 'owner', 'para': ['studio'], 'tipo': 'pregunta', 'texto': 'Sí', 'responde_a': 'M3'}]})
        with mock.patch.object(equipo, 'project', lambda pid: {'name': 'Alfa'}):
            self.assertEqual(equipo.hoy_decisiones(), ['lanzar 2 experimentos (/lote)', 'apuntar lo medido de 1 experimento (/lote)',
                                                       'decidir 2 cosas de Alfa (/lote)', 'responder 1 pregunta del equipo (/mesa)'])

    def test_one_line_lists_are_split(self):
        self.assertEqual(equipo.hoy_lineas('- Aprobar lote - Sol 10 min | Llamar'), ['Aprobar lote', 'Sol 10 min', 'Llamar'])

class Coach(unittest.TestCase):
    """One line at night, two on Sunday, and review cards from the week's work — all from Owner's own files."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); root = Path(self.tmp.name)
        self.ws = root / 'ws'; (self.ws / 'hoy').mkdir(parents=True); (root / 'state' / 'mesa').mkdir(parents=True); self.vault = root / 'vault'; self.vault.mkdir()
        self.sent = []; self.cards = '[{"tema": "Trading", "pregunta": "¿Qué es el drawdown máximo?", "respuesta": "La mayor caída desde un pico."}]'
        self.p = [mock.patch.object(equipo, 'WORKSPACE', self.ws), mock.patch.object(equipo, 'STATE', root / 'state'), mock.patch.object(equipo, 'VAULT', self.vault),
                  mock.patch.object(equipo, 'telegram', self.sent.append), mock.patch.object(equipo, 'freno', lambda: None),
                  mock.patch.object(equipo, 'claude', lambda prompt, *a, **k: '```json\n' + self.cards + '\n```'), mock.patch.object(equipo, 'lessons', lambda pid: [])]
        for x in self.p: x.start()
        self.sunday = equipo.now().replace(year=2026, month=10, day=18, hour=21, minute=45, second=0, microsecond=0)

    def tearDown(self):
        for x in self.p: x.stop()
        self.tmp.cleanup()

    def day(self, fecha, items, **kw): equipo.save(self.ws / 'hoy' / f'{fecha}.json', {'fecha': fecha, 'items': items, 'mensaje': 1, **kw})

    def test_the_day_closes_once_with_what_comes_tomorrow(self):
        self.day('2026-10-18', [{'t': 'Aprobar lote', 'hecho': True}, {'t': 'Llamar al gestor', 'hecho': False}])
        self.assertIsNone(equipo.cierre_dia(self.sunday.replace(hour=20)))
        self.assertEqual(equipo.cierre_dia(self.sunday), 'Hoy: 1/2 hecho. Mañana sigo con: Llamar al gestor.')
        self.assertIsNone(equipo.cierre_dia(self.sunday)); self.assertEqual(len(self.sent), 1)

    def test_the_week_counts_tasks_review_and_what_keeps_slipping(self):
        for n in range(3): self.day(f'2026-10-{18 - n}', [{'t': 'Llamar al gestor', 'hecho': False}, {'t': f'Hecha {n}', 'hecho': True}])
        (self.ws / 'repaso').mkdir(); (self.ws / 'repaso' / 'registro.jsonl').write_text('\n'.join(json.dumps({'fecha': '2026-10-17', 'id': 'x', 'g': g}) for g in (2, 2, 0, 1)))
        self.assertEqual(equipo.cierre_semana(self.sunday), 'Semana: 3/6 tareas · repaso 4 (50 % a la primera).\nSe arrastra: «Llamar al gestor» (3 días). ¿La hacemos o la quitamos?')
        self.assertIsNone(equipo.cierre_semana(self.sunday)); self.assertIsNone(equipo.cierre_semana(self.sunday.replace(day=17)))

    def test_weekly_cards_from_recent_notes_never_from_administracion(self):
        (self.vault / 'Administración').mkdir(); (self.vault / 'Administración' / 'iva.md').write_text('IBAN secreto')
        (self.vault / 'Trading.md').write_text('El drawdown máximo es la mayor caída desde un pico.')
        seen = []
        with mock.patch.object(equipo, 'claude', lambda prompt, *a, **k: seen.append(prompt) or '```json\n' + self.cards + '\n```'):
            self.assertEqual(equipo.repaso_semanal(self.sunday.replace(day=15)), 1)
        self.assertIn('Trading.md', seen[0]); self.assertNotIn('IBAN', seen[0])
        cards = json.loads((self.ws / 'repaso' / 'tarjetas.json').read_text())
        self.assertEqual((cards[0]['tema'], cards[0]['due'], cards[0]['reps']), ('Trading', '2026-10-15', 0))
        self.assertIsNone(equipo.repaso_semanal(self.sunday.replace(day=16)))      # not again until Sunday
        self.assertIsNone(equipo.repaso_semanal(self.sunday))                        # the same week, even on Sunday
        self.assertEqual(equipo.repaso_semanal(self.sunday.replace(day=25)), 0)      # next Sunday: the same card is not repeated

class Decisiones(unittest.TestCase):
    """Owner decides the important tasks of a batch one at a time, and the mesa reaches him with few, clear questions."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.state = Path(self.tmp.name); (self.state / 'proposals').mkdir()
        self.calls = []
        self.p = [mock.patch.object(equipo, 'STATE', self.state), mock.patch.object(equipo, '_approve', lambda pids, date=None, only=None, hold=None, by='Owner': self.calls.append((pids, only, sorted(hold or []))))]
        for x in self.p: x.start()
        equipo.save(self.state / 'proposals' / f'{equipo.today()}.json', {'proyectos': {'tf': {'estado': 'pendiente', 'indices': [3, 5, 6],
            'tareas': [{'titulo': 'Un reel'}, {'titulo': 'Afiliación'}, {'titulo': 'Mensajes'}]}}})

    def tearDown(self):
        for x in self.p: x.stop()
        self.tmp.cleanup()

    def test_yes_approves_only_that_task_and_keeps_the_rest_waiting(self):
        self.assertEqual(equipo.decidir_lote('tf', 5, 'si')['resultado'], 'aprobada')
        self.assertEqual(self.calls, [(['tf'], [1], [0, 2])])

    def test_no_discards_only_that_task_and_later_changes_nothing(self):
        equipo.decidir_lote('tf', 6, 'no'); equipo.decidir_lote('tf', 3, 'luego')
        self.assertEqual(self.calls, [(['tf'], [], [0, 1])])

    def test_unknown_or_decided_tasks_and_bad_answers(self):
        self.assertEqual(equipo.decidir_lote('tf', 9, 'si')['resultado'], 'esa tarea ya está decidida')
        with self.assertRaises(equipo.Stop): equipo.decidir_lote('tf', 3, 'quizás')

    def test_the_command_line_takes_both_kinds_of_decision(self):
        a = equipo.parser().parse_args(['decidir', 'tf', '--indice', '5', '--decision', 'si'])
        self.assertEqual((a.project, a.indice, a.decision), ('tf', 5, 'si'))
        a = equipo.parser().parse_args(['decidir', 't_0000abcd', '--decision', 'seguir'])
        self.assertEqual((a.project, a.indice, a.decision), ('t_0000abcd', None, 'seguir'))

    def test_in_the_mesa_nothing_goes_straight_to_owner(self):
        self.assertEqual(equipo.para_en_mesa('radar', ['owner']), ['alfred'])
        self.assertEqual(equipo.para_en_mesa('product', ['owner', 'control']), ['control'])
        self.assertEqual(equipo.para_en_mesa('alfred', ['owner']), ['todos'])
        self.assertEqual(equipo.para_en_mesa('studio', ['business']), ['business'])

    def test_questions_go_one_per_message_with_buttons(self):
        sent = []
        with mock.patch.object(equipo, 'telegram_send', lambda text, markup=None: sent.append((text, markup))):
            equipo.mandar_preguntas([{'id': f'M{i}', 'de': 'product', 'texto': f'¿Lanzo {i}?'} for i in range(5)])
        self.assertEqual(len(sent), equipo.PREGUNTAS_MAX)
        self.assertTrue(sent[0][0].endswith('te pregunta: ¿Lanzo 0?'))
        self.assertEqual([b['callback_data'] for row in sent[0][1]['inline_keyboard'] for b in row], ['q:M0:s', 'q:M0:n', 'q:M0:l', 'q:M0:r'])

class ParaTi(unittest.TestCase):
    """What waits for Owner is explained plainly and grouped; nothing can be lost on the way and Claude is asked only when it changes."""
    ITEMS = [{'clave': 'l:t_00000001', 'tipo': 'lanzar', 'proyecto': 'tf', 'titulo': 'Docs 28', 'ficha': {'que': 'Un reel'}},
             {'clave': 'l:t_00000002', 'tipo': 'lanzar', 'proyecto': 'tf', 'titulo': 'Docs 29', 'ficha': {'que': 'Otro reel'}},
             {'clave': 'd:tf:3', 'tipo': 'decidir', 'proyecto': 'tf', 'titulo': 'Afiliación', 'motivo': 'Cambia el precio'},
             {'clave': 'q:M7', 'tipo': 'pregunta', 'de': 'control', 'texto': '¿Aceptas X?'}]

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.state = Path(self.tmp.name)
        self.p = [mock.patch.object(equipo, 'STATE', self.state), mock.patch.object(equipo, 'freno', lambda: None),
                  mock.patch.object(equipo, 'pendientes_tuyas', lambda tb=None: self.items)]
        for x in self.p: x.start()
        self.items = list(self.ITEMS)

    def tearDown(self):
        for x in self.p: x.stop()
        self.tmp.cleanup()

    def test_unknown_keys_mixed_types_and_leftovers(self):
        raw = [{'claves': ['l:t_00000001', 'l:t_00000002', 'd:tf:3', 'x:inventada'], 'tipo': 'lanzar', 'titulo': 'Publicar 2 reels', 'que_es': 'Dos vídeos'},
               {'claves': ['l:t_00000001'], 'titulo': 'Repetida'}, 'basura']
        g = equipo.grupos_validos(raw, self.items)
        self.assertEqual(g[0]['claves'], ['l:t_00000001', 'l:t_00000002']); self.assertEqual(g[0]['titulo'], 'Publicar 2 reels')
        self.assertEqual(g[0]['tu_parte'], equipo.TU_PARTE['lanzar'])
        self.assertEqual(sorted(c for x in g for c in x['claves']), sorted(i['clave'] for i in self.items))
        sola = next(x for x in g if x['claves'] == ['d:tf:3'])
        self.assertEqual((sola['tipo'], sola['que_es']), ('decidir', 'Cambia el precio'))
        self.assertEqual(equipo.grupos_validos(None, self.items)[3]['titulo'], '¿Aceptas X?')

    def test_claude_is_asked_only_when_what_waits_changes(self):
        calls = []
        def fake(prompt, *a, **k):
            calls.append(prompt); return '```json\n[{"claves": ["l:t_00000001", "l:t_00000002"], "tipo": "lanzar", "titulo": "Publicar 2 reels"}]\n```'
        with mock.patch.object(equipo, 'claude', fake):
            first = equipo.para_ti(); equipo.para_ti()
            self.assertEqual(len(calls), 1); self.assertEqual(first[0]['titulo'], 'Publicar 2 reels')
            self.assertNotIn('Docs 28', ' '.join(x['titulo'] for x in first))
            self.items = self.items[:2]; equipo.para_ti()
            self.assertEqual(len(calls), 2)

    def test_status_keeps_only_what_still_waits(self):
        equipo.save(self.state / 'para_ti.json', {'clave': 'x', 'grupos': equipo.grupos_validos(None, self.items)})
        self.items = self.items[1:]
        self.assertNotIn('l:t_00000001', [c for g in equipo.para_ti_vigente() for c in g['claves']])

    def test_something_new_shows_up_before_it_is_explained(self):
        equipo.save(self.state / 'para_ti.json', {'clave': 'x', 'grupos': equipo.grupos_validos(None, self.items[:2])})
        claves = [c for g in equipo.para_ti_vigente() for c in g['claves']]
        self.assertEqual(sorted(claves), sorted(i['clave'] for i in self.items))

    def test_todo_uses_the_plain_titles(self):
        equipo.save(self.state / 'para_ti.json', {'clave': 'x', 'grupos': equipo.grupos_validos(
            [{'claves': ['l:t_00000001', 'l:t_00000002'], 'titulo': 'Publicar 2 reels de TF'}], self.items)})
        with mock.patch.object(equipo, 'pending_merge', lambda pid: 0):
            out = equipo.hoy_decisiones()
        self.assertEqual(out[0], 'publicar 2 reels de TF (/lote)'); self.assertIn('responder 1 pregunta del equipo (/mesa)', out)
        self.assertFalse(any('Docs' in x for x in out))


class Mejoras(unittest.TestCase):
    """What is waiting to be merged is described in plain words, regenerated only when the pending commits change."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.state = Path(self.tmp.name)
        self.commits = {'alfa': [('abc1234', 'equipo: Ficha de reels KC-R3')]}; self.calls = []
        def fake(prompt, *a, **k):
            self.calls.append(prompt); return '```json\n{"alfa": ["Un reel listo para publicar hoy"]}\n```'
        self.p = [mock.patch.object(equipo, 'STATE', self.state), mock.patch.object(equipo, 'freno', lambda: None),
                  mock.patch.object(equipo, 'por_juntar', lambda pid: self.commits.get(pid, [])), mock.patch.object(equipo, 'claude', fake)]
        for x in self.p: x.start()

    def tearDown(self):
        for x in self.p: x.stop()
        self.tmp.cleanup()

    def test_described_once_and_again_only_when_new_work_arrives(self):
        self.assertEqual(equipo.mejoras(), {'alfa': ['Un reel listo para publicar hoy']}); equipo.mejoras()
        self.assertEqual(len(self.calls), 1); self.assertNotIn('equipo: Ficha', self.calls[0])
        self.assertEqual(equipo.mejoras_vigentes('alfa'), ['Un reel listo para publicar hoy'])
        self.commits['alfa'].append(('def5678', 'equipo: Contador'))
        self.assertEqual(equipo.mejoras_vigentes('alfa'), [])
        equipo.mejoras(); self.assertEqual(len(self.calls), 2)

    def test_the_nightly_merge_says_what_went_in(self):
        equipo.mejoras(); sent = []
        with mock.patch.object(equipo, 'fusionar_project', lambda pid: 'fusionada en main' if pid == 'alfa' else 'nada que fusionar'), \
             mock.patch.object(equipo, 'notify', lambda t, x: sent.append(x)), mock.patch.object(equipo, 'log', lambda *a: None):
            equipo.fusionar(list(equipo.CONFIG['projects']))
        self.assertIn('fusionada en main\n• Un reel listo para publicar hoy', sent[0])


class Tablero(unittest.TestCase):
    def test_launch_card_carries_latest_parent_result(self):
        ficha = {'que': 'Landing A/B', 'a_quien': 'Tráfico frío', 'metrica': 'Registros', 'umbral': '5 % de conversión'}
        texto = 'Se registraron 12 personas. ' * 10
        def task(tid, spec):
            return {'id': tid, 'title': tid, 'status': 'ready', 'created_at': 1790000000, 'body': json.dumps(spec)}
        def fake_tasks(pid):
            return [task('t_hija', {'lanzamiento': ficha, 'viene_de': 't_padre'}),
                    task('t_sin', {'lanzamiento': ficha}),
                    task('t_invalida', {'lanzamiento': ficha, 'viene_de': '../padre'}),
                    task('t_sin_ficha', {'viene_de': 't_padre'}),
                    task('t_registro', {'lanzamiento': ficha, 'viene_de': 't_anterior'}),
                    task('t_id', {'lanzamiento': ficha, 'viene_de': 't_desconocida'})] if pid == 'owner-os' else []
        with tempfile.TemporaryDirectory() as tmp:
            equipo.save(Path(tmp) / 'experimentos' / 'owner-os.json', [
                {'tarea': 't_padre', 'titulo': 'Título anterior', 'texto': 'Resultado anterior', 'decision': 'seguir'},
                {'tarea': 't_padre', 'titulo': 'Experimento padre', 'texto': texto, 'decision': 'seguir'}])
            equipo.save(Path(tmp) / 'experimentos.json', {
                't_padre': {'titulo': 'Título del registro'}, 't_anterior': {'titulo': 'Experimento anterior'}})
            with mock.patch.object(equipo, 'STATE', Path(tmp)), mock.patch.object(equipo, 'tasks', fake_tasks), \
                 mock.patch.object(equipo, 'mesa_load', lambda: {'mensajes': []}), mock.patch.object(equipo, 'hermes_overview', lambda: {}):
                items = {i['id']: i for i in equipo.tablero() if i['fuente'] == 'equipo'}
        self.assertEqual(items['t_hija']['viene_de'], {'tarea': 't_padre', 'titulo': 'Experimento padre', 'resultado': texto[:200]})
        self.assertNotIn('viene_de', items['t_sin'])
        self.assertNotIn('viene_de', items['t_invalida'])
        self.assertNotIn('viene_de', items['t_sin_ficha'])
        self.assertEqual(items['t_registro']['viene_de'], {'tarea': 't_anterior', 'titulo': 'Experimento anterior'})
        self.assertEqual(items['t_id']['viene_de'], {'tarea': 't_desconocida', 'titulo': 't_desconocida'})

    def test_team_tasks_say_whether_alfred_ordered_them(self):
        def task(tid, spec):
            return {'id': tid, 'title': tid, 'status': 'ready', 'created_at': 1790000000, 'body': json.dumps(spec)}
        def fake_tasks(pid):
            return [task('t_alfred', {'porque': 'Lo pidió Owner', 'origen': 'alfred'}), task('t_lote', {'porque': 'Del lote'})] if pid == 'owner-os' else []
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(equipo, 'STATE', Path(tmp)), mock.patch.object(equipo, 'tasks', fake_tasks), \
                 mock.patch.object(equipo, 'mesa_load', lambda: {'mensajes': []}), mock.patch.object(equipo, 'hermes_overview', lambda: {}):
                items = {i['id']: i for i in equipo.tablero() if i['fuente'] == 'equipo'}
        self.assertEqual(items['t_alfred']['origen'], 'alfred')
        self.assertEqual(items['t_lote']['origen'], 'lote')

    def test_team_tasks_carry_their_launch_card_in_any_column(self):
        ficha = {'que': 'Landing A/B', 'a_quien': 'Tráfico frío', 'metrica': 'Registros', 'umbral': '5 % de conversión'}
        def task(tid, status, spec):
            return {'id': tid, 'title': tid, 'status': status, 'created_at': 1790000000, 'body': json.dumps(spec)}
        def fake_tasks(pid):
            return [task('t_ficha', 'ready', {'lanzamiento': ficha}), task('t_sin', 'ready', {'porque': 'Sin ficha'}),
                    task('t_bloqueada', 'blocked', {'lanzamiento': ficha})] if pid == 'owner-os' else []
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(equipo, 'STATE', Path(tmp)), mock.patch.object(equipo, 'tasks', fake_tasks), \
                 mock.patch.object(equipo, 'mesa_load', lambda: {'mensajes': []}), mock.patch.object(equipo, 'hermes_overview', lambda: {}):
                items = {i['id']: i for i in equipo.tablero() if i['fuente'] == 'equipo'}
        self.assertEqual(items['t_ficha']['lanzamiento'], ficha)
        self.assertNotIn('lanzamiento', items['t_sin'])
        self.assertEqual((items['t_bloqueada']['columna'], items['t_bloqueada']['lanzamiento']), ('bloqueado', ficha))

    def test_done_task_with_launch_card_waits_for_owner_until_launched(self):
        ficha = {'que': 'Landing A/B', 'a_quien': 'Tráfico frío', 'metrica': 'Registros', 'umbral': '5 % de conversión'}
        def task(tid, status, spec):
            return {'id': tid, 'title': tid, 'status': status, 'created_at': 1790000000, 'completed_at': equipo.time.time(), 'body': json.dumps(spec)}
        def fake_tasks(pid):
            return [task('t_lista', 'done', {'lanzamiento': ficha}), task('t_lanzada', 'done', {'lanzamiento': ficha}),
                    task('t_sin', 'done', {'porque': 'Sin ficha'}), task('t_cola', 'ready', {'lanzamiento': ficha})] if pid == 'owner-os' else []
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'experimentos.json').write_text(json.dumps({'t_lanzada': {'avisado': '2026-10-16T08:00:00', 'lanzado': (equipo.now() - timedelta(hours=1)).isoformat()}}))
            with mock.patch.object(equipo, 'STATE', Path(tmp)), mock.patch.object(equipo, 'tasks', fake_tasks), \
                 mock.patch.object(equipo, 'mesa_load', lambda: {'mensajes': []}), mock.patch.object(equipo, 'hermes_overview', lambda: {}):
                items = {i['id']: i for i in equipo.tablero() if i['fuente'] == 'equipo'}
        self.assertEqual((items['t_lista']['columna'], items['t_lista']['responsable'], items['t_lista']['fase']), ('para-ti', 'owner', 'lista para lanzar'))
        self.assertTrue(items['t_lista']['fusionada'])
        self.assertEqual((items['t_lanzada']['columna'], items['t_lanzada']['responsable']), ('hecho', 'product'))
        self.assertEqual(items['t_sin']['columna'], 'hecho')
        self.assertEqual(items['t_cola']['columna'], 'cola')

    def test_launched_experiment_without_result_after_48_hours_returns_to_owner(self):
        ficha = {'que': 'Landing A/B', 'a_quien': 'Tráfico frío', 'metrica': 'Registros', 'umbral': '5 % de conversión'}
        # Fixed clock spans Madrid's autumn DST change. These are elapsed hours,
        # not wall-clock subtraction (47 local hours can otherwise span 48 real ones).
        at = datetime(2026, 10, 26, 12, tzinfo=equipo.MADRID)
        recent, old = at.timestamp(), at.timestamp() - 10 * 86400
        def task(tid, completed_at):
            return {'id': tid, 'title': tid, 'status': 'done', 'created_at': 1790000000, 'completed_at': completed_at, 'body': json.dumps({'lanzamiento': ficha})}
        def fake_tasks(pid):
            return [task('t_sin_medir', recent), task('t_medida', recent), task('t_vieja', old), task('t_reciente', recent),
                    task('t_fecha_rota', recent), task('t_sin_fusionar', recent), task('t_fusionada', recent)] if pid == 'owner-os' else []
        hace = lambda horas: datetime.fromtimestamp(at.timestamp() - horas * 3600, equipo.MADRID).isoformat()
        registro = {'t_sin_medir': {'lanzado': hace(49)}, 't_medida': {'lanzado': hace(49)}, 't_vieja': {'lanzado': hace(49)},
                    't_reciente': {'lanzado': hace(47)}, 't_fecha_rota': {'lanzado': 'ayer por la tarde'}}
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'experimentos.json').write_text(json.dumps(registro))
            (Path(tmp) / 'experimentos').mkdir()
            (Path(tmp) / 'experimentos' / 'owner-os.json').write_text(json.dumps([{'fecha': '2026-10-16', 'texto': 'Convirtió el 7 %', 'tarea': 't_medida'}]))
            for tid, commit in (('t_sin_fusionar', 'aaa111'), ('t_fusionada', 'bbb222')):
                (Path(tmp) / 'runs' / tid).mkdir(parents=True)
                (Path(tmp) / 'runs' / tid / 'receipt.json').write_text(json.dumps({'commit': commit}))
            with mock.patch.object(equipo, 'STATE', Path(tmp)), mock.patch.object(equipo, 'tasks', fake_tasks), \
                 mock.patch.object(equipo, 'now', lambda: at), mock.patch.object(equipo.time, 'time', lambda: at.timestamp()), \
                 mock.patch.object(equipo, 'merged', lambda repo, base, commit: commit == 'bbb222'), \
                 mock.patch.object(equipo, 'mesa_load', lambda: {'mensajes': []}), mock.patch.object(equipo, 'hermes_overview', lambda: {}):
                items = {i['id']: i for i in equipo.tablero() if i['fuente'] == 'equipo'}
        self.assertEqual((items['t_sin_medir']['columna'], items['t_sin_medir']['responsable'], items['t_sin_medir']['fase']), ('para-ti', 'owner', 'falta medir'))
        self.assertEqual(items['t_medida']['columna'], 'hecho')
        self.assertEqual((items['t_vieja']['columna'], items['t_vieja']['fase']), ('para-ti', 'falta medir'))
        self.assertEqual(items['t_reciente']['columna'], 'hecho')
        self.assertEqual(items['t_fecha_rota']['columna'], 'hecho')
        self.assertEqual((items['t_sin_fusionar']['columna'], items['t_sin_fusionar']['fase']), ('para-ti', 'lista para lanzar · falta fusionar'))
        self.assertEqual((items['t_fusionada']['columna'], items['t_fusionada']['fase']), ('para-ti', 'lista para lanzar'))

    def test_launched_task_with_a_saved_result_is_marked_as_measured(self):
        ficha = {'que': 'Landing A/B', 'a_quien': 'Tráfico frío', 'metrica': 'Registros', 'umbral': '5 % de conversión'}
        def task(tid):
            return {'id': tid, 'title': tid, 'status': 'done', 'created_at': 1790000000, 'completed_at': equipo.time.time(), 'body': json.dumps({'lanzamiento': ficha})}
        def fake_tasks(pid):
            return [task('t_medida'), task('t_sin_medir')] if pid == 'owner-os' else []
        calls = []
        real = equipo.medidos
        def counting(pid):
            calls.append(pid)
            return real(pid)
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'experimentos.json').write_text(json.dumps({t: {'avisado': '2026-10-16T08:00:00', 'lanzado': '2026-10-16T09:00:00'} for t in ('t_medida', 't_sin_medir')}))
            (Path(tmp) / 'experimentos').mkdir()
            (Path(tmp) / 'experimentos' / 'owner-os.json').write_text(json.dumps([{'fecha': '2026-10-16', 'texto': 'Convirtió el 7 %', 'tarea': 't_medida'}]))
            with mock.patch.object(equipo, 'STATE', Path(tmp)), mock.patch.object(equipo, 'tasks', fake_tasks), mock.patch.object(equipo, 'medidos', counting), \
                 mock.patch.object(equipo, 'mesa_load', lambda: {'mensajes': []}), mock.patch.object(equipo, 'hermes_overview', lambda: {}):
                items = {i['id']: i for i in equipo.tablero() if i['fuente'] == 'equipo'}
        self.assertTrue(items['t_medida']['medido'])
        self.assertNotIn('medido', items['t_sin_medir'])
        self.assertEqual(sorted(calls), sorted(set(calls)))
        self.assertEqual(calls.count('owner-os'), 1)

    def test_measured_task_carries_the_latest_decision_it_has(self):
        ficha = {'que': 'Landing A/B', 'a_quien': 'Tráfico frío', 'metrica': 'Registros', 'umbral': '5 % de conversión'}
        def task(tid):
            return {'id': tid, 'title': tid, 'status': 'done', 'created_at': 1790000000, 'completed_at': equipo.time.time(), 'body': json.dumps({'lanzamiento': ficha})}
        def fake_tasks(pid):
            return [task('t_decidida'), task('t_sin_decision'), task('t_corregida')] if pid == 'owner-os' else []
        resultados = [{'fecha': '2026-10-16', 'texto': 'Convirtió el 7 %', 'tarea': 't_decidida', 'decision': 'parar'},
                      {'fecha': '2026-10-16', 'texto': 'Convirtió el 3 %', 'tarea': 't_sin_decision'},
                      {'fecha': '2026-10-16', 'texto': 'Primera lectura', 'tarea': 't_corregida', 'decision': 'seguir'},
                      {'fecha': '2026-10-17', 'texto': 'Segunda lectura', 'tarea': 't_corregida', 'decision': 'cambiar'},
                      {'fecha': '2026-10-18', 'texto': 'Tercera lectura sin decisión', 'tarea': 't_corregida'}]
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'experimentos.json').write_text(json.dumps({t: {'avisado': '2026-10-16T08:00:00', 'lanzado': '2026-10-16T09:00:00'} for t in ('t_decidida', 't_sin_decision', 't_corregida')}))
            (Path(tmp) / 'experimentos').mkdir()
            (Path(tmp) / 'experimentos' / 'owner-os.json').write_text(json.dumps(resultados))
            with mock.patch.object(equipo, 'STATE', Path(tmp)), mock.patch.object(equipo, 'tasks', fake_tasks), \
                 mock.patch.object(equipo, 'mesa_load', lambda: {'mensajes': []}), mock.patch.object(equipo, 'hermes_overview', lambda: {}):
                items = {i['id']: i for i in equipo.tablero() if i['fuente'] == 'equipo'}
        self.assertEqual(items['t_decidida']['decision'], 'parar')
        self.assertTrue(items['t_sin_decision']['medido'])
        self.assertNotIn('decision', items['t_sin_decision'])
        self.assertEqual(items['t_corregida']['decision'], 'cambiar')

    def test_recent_measured_experiment_without_decision_returns_to_owner(self):
        ficha = {'que': 'Landing A/B', 'a_quien': 'Tráfico frío', 'metrica': 'Registros', 'umbral': '5 % de conversión'}
        at = datetime(2026, 10, 26, 12, tzinfo=equipo.MADRID)
        recent, old = at.timestamp(), at.timestamp() - 10 * 86400
        tids = ('t_reciente', 't_decidida', 't_antigua', 't_completada', 't_sin_hora', 't_hora_rota', 't_limite', 't_decision_previa')
        def task(tid):
            return {'id': tid, 'title': tid, 'status': 'done', 'created_at': 1790000000, 'completed_at': old if tid == 't_completada' else recent,
                    'body': json.dumps({'lanzamiento': ficha})}
        def fake_tasks(pid):
            return [task(tid) for tid in tids] if pid == 'owner-os' else []
        hace = lambda dias: datetime.fromtimestamp(at.timestamp() - dias * 86400, equipo.MADRID).isoformat()
        resultados = [{'tarea': tid, 'hora': hace(1)} for tid in tids]
        resultados[1]['decision'] = 'seguir'
        resultados[7]['decision'] = 'cambiar'
        resultados.extend([{'tarea': 't_antigua', 'hora': hace(8)}, {'tarea': 't_sin_hora'},
                           {'tarea': 't_hora_rota', 'hora': 'ayer por la tarde'}, {'tarea': 't_limite', 'hora': hace(7)},
                           {'tarea': 't_decision_previa', 'hora': hace(1)}])
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'experimentos.json').write_text(json.dumps({tid: {'lanzado': hace(10)} for tid in tids}))
            (Path(tmp) / 'experimentos').mkdir()
            (Path(tmp) / 'experimentos' / 'owner-os.json').write_text(json.dumps(resultados))
            with mock.patch.object(equipo, 'STATE', Path(tmp)), mock.patch.object(equipo, 'tasks', fake_tasks), mock.patch.object(equipo, 'now', lambda: at), \
                 mock.patch.object(equipo.time, 'time', lambda: at.timestamp()), \
                 mock.patch.object(equipo, 'mesa_load', lambda: {'mensajes': []}), mock.patch.object(equipo, 'hermes_overview', lambda: {}):
                items = {i['id']: i for i in equipo.tablero() if i['fuente'] == 'equipo'}
        for tid in ('t_reciente', 't_completada', 't_limite'):
            with self.subTest(tarea=tid):
                self.assertEqual((items[tid]['columna'], items[tid]['responsable'], items[tid]['fase']), ('para-ti', 'owner', 'falta decidir'))
        for tid in ('t_decidida', 't_antigua', 't_sin_hora', 't_hora_rota', 't_decision_previa'):
            with self.subTest(tarea=tid):
                self.assertEqual(items[tid]['columna'], 'hecho')
        self.assertEqual(items['t_decision_previa']['decision'], 'cambiar')

    def test_blocked_team_tasks_say_the_phase_they_stopped_in(self):
        def task(tid):
            return {'id': tid, 'title': tid, 'status': 'blocked', 'created_at': 1790000000, 'body': '{}'}
        def fake_tasks(pid):
            return [task('t_con_fase'), task('t_sin_fase')] if pid == 'owner-os' else []
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'runs' / 't_con_fase').mkdir(parents=True)
            (Path(tmp) / 'runs' / 't_con_fase' / 'fase.json').write_text(json.dumps({'fase': 'probando', 'intento': 2}))
            with mock.patch.object(equipo, 'STATE', Path(tmp)), mock.patch.object(equipo, 'tasks', fake_tasks), \
                 mock.patch.object(equipo, 'mesa_load', lambda: {'mensajes': []}), mock.patch.object(equipo, 'hermes_overview', lambda: {}):
                items = {i['id']: i for i in equipo.tablero() if i['fuente'] == 'equipo'}
        self.assertEqual((items['t_con_fase']['fase'], items['t_con_fase']['parada'], items['t_con_fase']['intento']), ('bloqueada', 'probando', 2))
        self.assertNotIn('parada', items['t_sin_fase'])
        self.assertNotIn('intento', items['t_sin_fase'])

    def test_superseded_matches_done_title(self):
        for status in ('blocked', 'triage'):
            with self.subTest(status=status):
                ts = [{'id': 't_blocked', 'title': 'Entregas: lista A', 'status': status},
                      {'id': 't_done', 'title': 'entregas: lista a…', 'status': 'done'}]
                self.assertEqual(equipo.superseded(ts), {'t_blocked'})

    def test_superseded_keeps_blocked_without_done_twin(self):
        ts = [{'id': 't_blocked', 'title': 'Entregas: lista A', 'status': 'blocked'},
              {'id': 't_done', 'title': 'Entregas: lista B', 'status': 'done'}]
        self.assertEqual(equipo.superseded(ts), set())

    def test_superseded_keeps_blocked_with_only_ready_twin(self):
        ts = [{'id': 't_blocked', 'title': 'Entregas: lista A', 'status': 'blocked'},
              {'id': 't_ready', 'title': 'entregas: lista a…', 'status': 'ready'}]
        self.assertEqual(equipo.superseded(ts), set())

    def test_checklist_hides_superseded_blocked_task(self):
        moment = equipo.time.time()
        ts = [{'id': 't_blocked', 'title': 'Entregas: lista A', 'status': 'blocked', 'created_at': moment - 30},
              {'id': 't_done', 'title': 'entregas: lista a…', 'status': 'done', 'created_at': moment - 20, 'completed_at': moment - 10},
              {'id': 't_other', 'title': 'Entregas: lista B', 'status': 'blocked', 'created_at': moment}]
        items = {t['id']: t for t in equipo.checklist(ts)}
        self.assertNotIn('t_blocked', items)
        self.assertEqual((items['t_done']['estado'], items['t_other']['estado']), ('hecha', 'bloqueada'))

    def test_project_brief_hides_superseded_blocked_task(self):
        for status in ('blocked', 'triage'):
            with self.subTest(status=status):
                ts = [{'id': 't_blocked', 'title': 'Motor: A', 'status': status},
                      {'id': 't_done', 'title': 'motor: a…', 'status': 'done'},
                      {'id': 't_other', 'title': 'Motor: B', 'status': status}]
                with mock.patch.object(equipo, 'project', lambda pid: {'name': 'Motor', 'goal': 'Mejorar el motor'}), \
                     mock.patch.object(equipo, 'tasks', return_value=ts) as tasks, \
                     mock.patch.object(equipo, 'STATE', Path(_ISOLATION.name)), \
                     mock.patch.object(equipo, 'metrics', lambda pid: {}), mock.patch.object(equipo, 'lessons', lambda pid: []), \
                     mock.patch.object(equipo, 'ficha', lambda pid: None):
                    brief = equipo.project_brief('owner-os')
                tasks.assert_called_once_with('owner-os')
                self.assertEqual(brief['bloqueadas'], ['Motor: B: '])

    def test_retro_hides_superseded_blocked_task_in_prompt(self):
        for status in ('blocked', 'triage'):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as tmp:
                ts = [{'id': 't_blocked', 'title': 'Motor: A', 'status': status},
                      {'id': 't_done', 'title': 'motor: a…', 'status': 'done'},
                      {'id': 't_other', 'title': 'Motor: B', 'status': status}]
                with mock.patch.object(equipo, 'STATE', Path(tmp)), \
                     mock.patch.object(equipo, 'receipts', return_value=[{'tarea': 't_done', 'estado': 'integrada'}]), \
                     mock.patch.object(equipo, 'tasks', return_value=ts) as tasks, \
                     mock.patch.object(equipo, 'project', lambda pid: {'name': 'Motor', 'repo': tmp}), \
                     mock.patch.object(equipo, 'git', return_value='abc'), mock.patch.object(equipo, 'worktree', return_value=Path(tmp)), \
                     mock.patch.object(equipo, 'metrics', lambda pid: {}), mock.patch.object(equipo, 'lessons', lambda pid: []), \
                     mock.patch.object(equipo, 'log'), mock.patch.object(equipo, 'claude', return_value='```json\n{}\n```') as claude:
                    self.assertEqual(equipo.retro('owner-os'), {})
                tasks.assert_called_once_with('owner-os')
                claude.assert_called_once()
                prompt = claude.call_args[0][0]
                self.assertIn('t_other', prompt)
                self.assertNotIn('t_blocked', prompt)

    def test_status_checklist_matches_blocked_tasks_after_replacement(self):
        moment = equipo.time.time()
        ts = [{'id': 't_blocked', 'title': 'Entregas: lista A', 'status': 'blocked', 'created_at': moment - 30},
              {'id': 't_done', 'title': 'entregas: lista a…', 'status': 'done', 'created_at': moment - 20, 'completed_at': moment - 10},
              {'id': 't_other', 'title': 'Entregas: lista B', 'status': 'blocked', 'created_at': moment}]
        config = {**equipo.CONFIG, 'projects': {'owner-os': equipo.CONFIG['projects']['owner-os']}}
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(equipo, 'CONFIG', config), mock.patch.object(equipo, 'STATE', Path(tmp)), \
                 mock.patch.object(equipo, 'tasks', lambda pid: ts), mock.patch.object(equipo, 'lessons', lambda pid: []), \
                 mock.patch.object(equipo, 'metrics', lambda pid: {}), mock.patch.object(equipo, 'pending_merge', lambda pid: 0), \
                 mock.patch.object(equipo, 'hermes_overview', lambda: {}), mock.patch.object(equipo, 'modelos_hoy', lambda: {}), \
                 mock.patch.object(equipo, 'tablero', lambda: []), mock.patch.object(equipo, 'mesa_load', lambda: {'mensajes': []}):
                project = equipo.status()['proyectos']['owner-os']
        self.assertEqual([t['id'] for t in project['bloqueadas']], ['t_other'])
        self.assertEqual([t['estado'] for t in project['tareas']].count('bloqueada'), 1)

    def test_board_hides_superseded_blocked_tasks(self):
        def task(tid, title, status):
            return {'id': tid, 'title': title, 'status': status, 'created_at': 1790000000, 'body': '{}'}
        def fake_tasks(pid):
            return [task('t_blocked', 'Entregas: lista A', 'blocked'),
                    task('t_done', 'entregas: lista a…', 'done'),
                    task('t_other', 'Entregas: lista B', 'blocked')] if pid == 'owner-os' else []
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(equipo, 'STATE', Path(tmp)), mock.patch.object(equipo, 'tasks', fake_tasks), \
                 mock.patch.object(equipo, 'mesa_load', lambda: {'mensajes': []}), mock.patch.object(equipo, 'hermes_overview', lambda: {}):
                items = {i['id']: i for i in equipo.tablero()}
        self.assertNotIn('t_blocked', items)
        self.assertEqual(items['t_other']['columna'], 'bloqueado')

class LaunchNotice(unittest.TestCase):
    """A finished task with a launch card tells Owner it is ready; a failing notice never blocks the task."""
    ficha = {'que': 'Landing A/B', 'a_quien': 'Tráfico frío', 'metrica': 'Registros', 'umbral': '5 % de conversión'}

    def task(self, spec):
        return {'id': 't_lanza', 'title': 'Landing nueva', 'status': 'ready', 'assignee': equipo.LANE, 'created_at': 1790000000, 'body': json.dumps(spec)}

    def test_card_sends_text_with_four_lines_to_owner(self):
        sent, posted = [], []
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(equipo, 'STATE', Path(tmp)), \
             mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS'}), mock.patch.object(equipo, 'telegram', lambda t, botones=None: sent.append(t)), \
             mock.patch.object(equipo, 'post', lambda *a, **k: posted.append(a)):
            out = equipo.avisar_lanzamiento('owner-os', self.task({'lanzamiento': self.ficha}))
        self.assertEqual(sent, [out])
        for line in ('Owner OS', 'Landing nueva', 'Qué: Landing A/B', 'A quién: Tráfico frío', 'Métrica: Registros', 'Umbral: 5 % de conversión'):
            self.assertIn(line, out)
        self.assertEqual(posted[0][:2], ('alfred', ['owner']))
        self.assertIn('alfred', equipo.DEPARTMENTS)

    def test_card_with_parent_result_sends_its_title_and_truncated_result(self):
        sent, posted = [], []
        resultado = 'x' * 150
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(equipo, 'STATE', Path(tmp)), \
             mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS'}), \
             mock.patch.object(equipo, 'resultados', lambda pid: [{'tarea': 't_padre', 'titulo': 'Experimento padre', 'texto': resultado}]), \
             mock.patch.object(equipo, 'telegram', lambda t, botones=None: sent.append(t)), \
             mock.patch.object(equipo, 'post', lambda *a, **k: posted.append(a)):
            out = equipo.avisar_lanzamiento('owner-os', self.task({'lanzamiento': self.ficha, 'viene_de': 't_padre'}))
        linea = f"Viene de: «Experimento padre» — {'x' * 139}…"
        self.assertIn(linea, out)
        self.assertEqual(sent, [out])
        self.assertEqual(posted[0][2], out)

    def test_card_with_parent_without_result_sends_its_id(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(equipo, 'STATE', Path(tmp)), \
             mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS'}), \
             mock.patch.object(equipo, 'resultados', lambda pid: []), \
             mock.patch.object(equipo, 'telegram'), mock.patch.object(equipo, 'post'):
            out = equipo.avisar_lanzamiento('owner-os', self.task({'lanzamiento': self.ficha, 'viene_de': 't_padre'}))
        self.assertTrue(out.endswith('\nViene de: «t_padre»'))

    def test_card_without_parent_keeps_the_original_text(self):
        esperado = ('🚀 Listo para lanzar en Owner OS: «Landing nueva»\n'
                    'Qué: Landing A/B\nA quién: Tráfico frío\nMétrica: Registros\nUmbral: 5 % de conversión')
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(equipo, 'STATE', Path(tmp)), \
             mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS'}), \
             mock.patch.object(equipo, 'telegram'), mock.patch.object(equipo, 'post'):
            out = equipo.avisar_lanzamiento('owner-os', self.task({'lanzamiento': self.ficha}))
        self.assertEqual(out, esperado)

    def test_notice_records_unmerged_status_only_on_first_notice(self):
        for merged in (False, True):
            with self.subTest(merged=merged), tempfile.TemporaryDirectory() as tmp, \
                 mock.patch.object(equipo, 'STATE', Path(tmp)), \
                 mock.patch.object(equipo, 'project', return_value={'name': 'Owner OS', 'repo': 'repo', 'base': 'main'}), \
                 mock.patch.object(equipo, 'merged', return_value=merged) as fusionado, \
                 mock.patch.object(equipo, 'pending_merge', return_value=1), \
                 mock.patch.object(equipo, 'telegram'), mock.patch.object(equipo, 'post'):
                equipo.save(Path(tmp) / 'runs' / 't_lanza' / 'receipt.json', {'commit': 'abc123'})
                task = self.task({'lanzamiento': self.ficha})
                with mock.patch.object(equipo, 'save', wraps=equipo.save) as guardar:
                    equipo.avisar_lanzamiento('owner-os', task)
                guardar.assert_called_once()
                registro = equipo.lanzamientos()
                if merged: self.assertNotIn('sin_fusionar', registro['t_lanza'])
                else: self.assertIs(registro['t_lanza']['sin_fusionar'], True)
                fusionado.return_value = not merged
                with mock.patch.object(equipo, 'save', wraps=equipo.save) as guardar:
                    equipo.avisar_lanzamiento('owner-os', task)
                guardar.assert_not_called()
                self.assertEqual(equipo.lanzamientos(), registro)

    def test_card_with_unmerged_commit_explains_how_to_merge_before_launching(self):
        sent, posted = [], []
        line = 'Aún no está en la versión principal: se fusiona esta noche, o pulsa «Fusionar ahora» aquí abajo antes de lanzarlo.'
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            (state / 'runs' / 't_lanza').mkdir(parents=True)
            (state / 'runs' / 't_lanza' / 'receipt.json').write_text(json.dumps({'commit': 'abc123'}))
            with mock.patch.object(equipo, 'STATE', state), \
                 mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS', 'repo': 'repo', 'base': 'main'}), \
                 mock.patch.object(equipo, 'merged', lambda repo, base, commit: False), \
                 mock.patch.object(equipo, 'pending_merge', lambda pid: 1), \
                 mock.patch.object(equipo, 'telegram', lambda t, botones=None: sent.append(t)), \
                 mock.patch.object(equipo, 'post', lambda *a, **k: posted.append(a)):
                out = equipo.avisar_lanzamiento('owner-os', self.task({'lanzamiento': self.ficha}))
        self.assertTrue(out.endswith(line))
        self.assertEqual(sent, [out])
        self.assertEqual(posted[0][2], out)

    def test_card_with_unmerged_commit_sends_launch_and_merge_buttons(self):
        sent = []
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            (state / 'runs' / 't_lanza').mkdir(parents=True)
            (state / 'runs' / 't_lanza' / 'receipt.json').write_text(json.dumps({'commit': 'abc123'}))
            with mock.patch.object(equipo, 'STATE', state), \
                 mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS', 'repo': 'repo', 'base': 'main'}), \
                 mock.patch.object(equipo, 'merged', lambda repo, base, commit: False), \
                 mock.patch.object(equipo, 'pending_merge', lambda pid: 1), \
                 mock.patch.object(equipo, 'telegram', lambda t, botones=None: sent.append((t, botones))), \
                 mock.patch.object(equipo, 'post'):
                equipo.avisar_lanzamiento('owner-os', self.task({'lanzamiento': self.ficha}))
        self.assertEqual(sent[0][1], [[{'text': 'Ya lo he lanzado', 'callback_data': 'l:t_lanza'}, {'text': 'No lo lanzo', 'callback_data': 'n:t_lanza'}],
                                       [{'text': 'Fusionar ahora', 'callback_data': 'f:owner-os'}]])

    def test_card_with_merged_commit_keeps_the_original_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            (state / 'runs' / 't_lanza').mkdir(parents=True)
            (state / 'runs' / 't_lanza' / 'receipt.json').write_text(json.dumps({'commit': 'abc123'}))
            with mock.patch.object(equipo, 'STATE', state), \
                 mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS', 'repo': 'repo', 'base': 'main'}), \
                 mock.patch.object(equipo, 'merged', lambda repo, base, commit: True), \
                 mock.patch.object(equipo, 'telegram'), mock.patch.object(equipo, 'post'):
                out = equipo.avisar_lanzamiento('owner-os', self.task({'lanzamiento': self.ficha}))
        self.assertNotIn('Aún no está en la versión principal', out)

    def test_card_still_sends_when_merging_check_fails(self):
        sent = []
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            (state / 'runs' / 't_lanza').mkdir(parents=True)
            (state / 'runs' / 't_lanza' / 'receipt.json').write_text(json.dumps({'commit': 'abc123'}))
            with mock.patch.object(equipo, 'STATE', state), \
                 mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS', 'repo': 'repo', 'base': 'main'}), \
                 mock.patch.object(equipo, 'merged', side_effect=RuntimeError('git caído')), \
                 mock.patch.object(equipo, 'telegram', lambda t, botones=None: sent.append(t)), mock.patch.object(equipo, 'post'):
                out = equipo.avisar_lanzamiento('owner-os', self.task({'lanzamiento': self.ficha}))
        self.assertNotIn('Aún no está en la versión principal', out)
        self.assertEqual(sent, [out])

    def test_card_sends_launched_button(self):
        sent = []
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            (state / 'runs' / 't_lanza').mkdir(parents=True)
            (state / 'runs' / 't_lanza' / 'receipt.json').write_text(json.dumps({'commit': 'abc123'}))
            with mock.patch.object(equipo, 'STATE', state), \
                 mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS', 'repo': 'repo', 'base': 'main'}), \
                 mock.patch.object(equipo, 'merged', lambda repo, base, commit: True), \
                 mock.patch.object(equipo, 'telegram', lambda t, botones=None: sent.append((t, botones))), \
                 mock.patch.object(equipo, 'post'):
                equipo.avisar_lanzamiento('owner-os', self.task({'lanzamiento': self.ficha}))
        self.assertEqual(sent[0][1], [[{'text': 'Ya lo he lanzado', 'callback_data': 'l:t_lanza'}, {'text': 'No lo lanzo', 'callback_data': 'n:t_lanza'}]])

    def test_card_with_invalid_task_id_and_unmerged_commit_sends_only_merge_button(self):
        sent = []
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            (state / 'runs' / 'ab').mkdir(parents=True)
            (state / 'runs' / 'ab' / 'receipt.json').write_text(json.dumps({'commit': 'abc123'}))
            with mock.patch.object(equipo, 'STATE', state), \
                 mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS', 'repo': 'repo', 'base': 'main'}), \
                 mock.patch.object(equipo, 'merged', lambda repo, base, commit: False), \
                 mock.patch.object(equipo, 'pending_merge', lambda pid: 1), \
                 mock.patch.object(equipo, 'telegram', lambda t, botones=None: sent.append((t, botones))), \
                 mock.patch.object(equipo, 'post'):
                equipo.avisar_lanzamiento('owner-os', {**self.task({'lanzamiento': self.ficha}), 'id': 'ab'})
        self.assertEqual(sent[0][1], [[{'text': 'Fusionar ahora', 'callback_data': 'f:owner-os'}]])

    def test_card_with_unmerged_commit_names_three_other_improvements(self):
        sent, posted = [], []
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            (state / 'runs' / 't_lanza').mkdir(parents=True)
            (state / 'runs' / 't_lanza' / 'receipt.json').write_text(json.dumps({'commit': 'abc123'}))
            with mock.patch.object(equipo, 'STATE', state), \
                 mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS', 'repo': 'repo', 'base': 'main'}), \
                 mock.patch.object(equipo, 'merged', lambda repo, base, commit: False), \
                 mock.patch.object(equipo, 'pending_merge', lambda pid: 4), \
                 mock.patch.object(equipo, 'telegram', lambda t, botones=None: sent.append(t)), \
                 mock.patch.object(equipo, 'post', lambda *a, **k: posted.append(a)):
                out = equipo.avisar_lanzamiento('owner-os', self.task({'lanzamiento': self.ficha}))
        self.assertTrue(out.endswith('Al fusionar entran también 3 mejoras más del equipo.'))
        self.assertEqual(sent, [out])
        self.assertEqual(posted[0][2], out)

    def test_card_with_unmerged_commit_names_one_other_improvement(self):
        sent, posted = [], []
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            (state / 'runs' / 't_lanza').mkdir(parents=True)
            (state / 'runs' / 't_lanza' / 'receipt.json').write_text(json.dumps({'commit': 'abc123'}))
            with mock.patch.object(equipo, 'STATE', state), \
                 mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS', 'repo': 'repo', 'base': 'main'}), \
                 mock.patch.object(equipo, 'merged', lambda repo, base, commit: False), \
                 mock.patch.object(equipo, 'pending_merge', lambda pid: 2), \
                 mock.patch.object(equipo, 'telegram', lambda t, botones=None: sent.append(t)), \
                 mock.patch.object(equipo, 'post', lambda *a, **k: posted.append(a)):
                out = equipo.avisar_lanzamiento('owner-os', self.task({'lanzamiento': self.ficha}))
        self.assertTrue(out.endswith('Al fusionar entran también 1 mejora más del equipo.'))
        self.assertEqual(sent, [out])
        self.assertEqual(posted[0][2], out)

    def test_card_with_unmerged_commit_keeps_merge_button_when_count_fails(self):
        sent, posted = [], []
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            (state / 'runs' / 't_lanza').mkdir(parents=True)
            (state / 'runs' / 't_lanza' / 'receipt.json').write_text(json.dumps({'commit': 'abc123'}))
            with mock.patch.object(equipo, 'STATE', state), \
                 mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS', 'repo': 'repo', 'base': 'main'}), \
                 mock.patch.object(equipo, 'merged', lambda repo, base, commit: False), \
                 mock.patch.object(equipo, 'pending_merge', side_effect=RuntimeError('git caído')), \
                 mock.patch.object(equipo, 'telegram', lambda t, botones=None: sent.append((t, botones))), \
                 mock.patch.object(equipo, 'post', lambda *a, **k: posted.append(a)):
                out = equipo.avisar_lanzamiento('owner-os', self.task({'lanzamiento': self.ficha}))
        self.assertNotIn('Al fusionar entran también', out)
        self.assertEqual(sent[0][0], out)
        self.assertEqual(posted[0][2], out)
        self.assertIn({'text': 'Fusionar ahora', 'callback_data': 'f:owner-os'}, sent[0][1][1])

    def test_card_without_valid_or_short_callback_sends_no_button(self):
        for tid in ('ab', 'a' * 70):
            sent = []
            with tempfile.TemporaryDirectory() as tmp, mock.patch.object(equipo, 'STATE', Path(tmp)), \
                 mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS'}), \
                 mock.patch.object(equipo, 'telegram', lambda t, botones=None: sent.append((t, botones))), \
                 mock.patch.object(equipo, 'post'):
                equipo.avisar_lanzamiento('owner-os', {**self.task({'lanzamiento': self.ficha}), 'id': tid})
            self.assertIsNone(sent[0][1])

    def test_telegram_sends_buttons_only_when_given(self):
        link = {'chatId': 42}
        response = mock.Mock()
        with mock.patch.object(equipo, 'load', return_value=link), \
             mock.patch.object(equipo.pf, 'secret', return_value='123456:abcdefghijklmnopqrstuvwxyz'), \
             mock.patch('urllib.request.urlopen', return_value=response) as urlopen:
            equipo.telegram('Con botón', [[{'text': 'Lanzado', 'callback_data': 'l:t_lanza'}]])
            equipo.telegram('Sin botón')
        with_button = json.loads(urlopen.call_args_list[0].args[0].data)
        without_button = json.loads(urlopen.call_args_list[1].args[0].data)
        self.assertEqual(with_button['reply_markup']['inline_keyboard'], [[{'text': 'Lanzado', 'callback_data': 'l:t_lanza'}]])
        self.assertNotIn('reply_markup', without_button)

    def test_no_card_or_incomplete_card_sends_nothing(self):
        incomplete = {k: v for k, v in self.ficha.items() if k != 'umbral'}
        calls = []
        with mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS'}), mock.patch.object(equipo, 'telegram', lambda t, botones=None: calls.append(t)), \
             mock.patch.object(equipo, 'post', lambda *a, **k: calls.append(a)):
            for spec in ({'porque': 'Sin ficha'}, {'lanzamiento': incomplete}, {'lanzamiento': 'texto'}):
                self.assertIsNone(equipo.avisar_lanzamiento('owner-os', self.task(spec)))
            self.assertIsNone(equipo.avisar_lanzamiento('owner-os', {**self.task({}), 'body': None}))
        self.assertEqual(calls, [])

    def run_done(self, telegram):
        from contextlib import contextmanager
        @contextmanager
        def fake_board(pid): yield None
        task = self.task({'lanzamiento': self.ficha})
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); state = root / 'state'; state.mkdir()
            (state / 'approved.json').write_text(json.dumps({task['id']: 'hash'}))
            with mock.patch.object(equipo, 'ROOT', root), mock.patch.object(equipo, 'STATE', state), \
                 mock.patch.object(equipo, 'tasks', lambda pid, status=None: [task]), mock.patch.object(equipo, 'board', fake_board), \
                 mock.patch.object(equipo.kb, 'claim_task', lambda *a, **k: mock.Mock(current_run_id=1)), \
                 mock.patch.object(equipo.kb, 'complete_task', lambda *a, **k: None), mock.patch.object(equipo, 'sync_base', lambda pid: None), \
                 mock.patch.object(equipo, 'execute', lambda *a: 'Integrada.'), mock.patch.object(equipo.subprocess, 'Popen'), \
                 mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS'}), mock.patch.object(equipo, 'telegram', telegram), \
                 mock.patch.object(equipo, 'post', lambda *a, **k: None), mock.patch.object(equipo, 'log'):
                return equipo.run_project('owner-os')

    def test_run_project_notifies_and_survives_a_failing_notice(self):
        sent = []
        self.assertEqual(self.run_done(lambda t, botones=None: sent.append(t)), 'hecha')
        self.assertTrue(any('Listo para lanzar' in t and 'Landing nueva' in t for t in sent))
        def broken(text, botones=None): raise RuntimeError('Telegram caído')
        self.assertEqual(self.run_done(broken), 'hecha')

    def run_blocked(self, error, fase=None):
        from contextlib import contextmanager
        @contextmanager
        def fake_board(pid): yield None
        task = self.task({'lanzamiento': self.ficha}); reasons = []
        def raises(*a): raise error
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); state = root / 'state'; state.mkdir()
            (state / 'approved.json').write_text(json.dumps({task['id']: 'hash'}))
            if fase is not None:
                (state / 'runs' / task['id']).mkdir(parents=True)
                (state / 'runs' / task['id'] / 'fase.json').write_text(json.dumps(fase))
            with mock.patch.object(equipo, 'ROOT', root), mock.patch.object(equipo, 'STATE', state), \
                 mock.patch.object(equipo, 'tasks', lambda pid, status=None: [task]), mock.patch.object(equipo, 'board', fake_board), \
                 mock.patch.object(equipo.kb, 'claim_task', lambda *a, **k: mock.Mock(current_run_id=1)), \
                 mock.patch.object(equipo.kb, 'block_task', lambda *a, **k: reasons.append(k['reason'])), mock.patch.object(equipo, 'sync_base', lambda pid: None), \
                 mock.patch.object(equipo, 'execute', raises), mock.patch.object(equipo.subprocess, 'Popen'), \
                 mock.patch.object(equipo, 'follow_up'), mock.patch.object(equipo, 'avisar_encargo'), \
                 mock.patch.object(equipo, 'post', lambda *a, **k: None), mock.patch.object(equipo, 'log'):
                self.assertEqual(equipo.run_project('owner-os'), 'bloqueada')
        return reasons[0]

    def run_network_failure(self, veces=None, ultima=None, reiniciar=False):
        from contextlib import contextmanager
        @contextmanager
        def fake_board(pid): yield None
        task = self.task({'lanzamiento': self.ficha})
        error = 'API inaccesible tras 3 intentos: ENOTFOUND'
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); state = root / 'state'; state.mkdir()
            (state / 'approved.json').write_text(json.dumps({task['id']: 'hash'}))
            folder = state / 'runs' / task['id']; folder.mkdir(parents=True)
            red = {'veces': veces}
            if ultima is not None: red['ultima'] = ultima
            if veces is not None: equipo.save(folder / 'red.json', red)
            def raises(*a):
                equipo.save(folder / 'receipt.json', {'estado': 'bloqueada', 'error': error})
                raise equipo.Stop(error)
            with mock.patch.object(equipo, 'ROOT', root), mock.patch.object(equipo, 'STATE', state), \
                 mock.patch.object(equipo, 'tasks', lambda pid, status=None: [task]), mock.patch.object(equipo, 'board', fake_board), \
                 mock.patch.object(equipo.kb, 'claim_task', lambda *a, **k: mock.Mock(current_run_id=1)), \
                 mock.patch.object(equipo.kb, 'reclaim_task') as reclaim, mock.patch.object(equipo.kb, 'block_task') as block, \
                 mock.patch.object(equipo, 'sync_base'), mock.patch.object(equipo, 'execute', raises), \
                 mock.patch.object(equipo.subprocess, 'Popen'), mock.patch.object(equipo, 'lid_will_sleep', return_value=False), \
                 mock.patch.object(equipo, 'sleep_clock', return_value=0), mock.patch.object(equipo, 'follow_up') as follow, \
                 mock.patch.object(equipo, 'avisar_encargo') as notice, mock.patch.object(equipo, 'post') as post, mock.patch.object(equipo, 'log'):
                result = equipo.run_project('owner-os')
                if veces == 3 and not reiniciar:
                    self.assertEqual(result, 'bloqueada')
                    reclaim.assert_not_called()
                    block.assert_called_once()
                    self.assertEqual(block.call_args.kwargs['reason'], error)
                else:
                    self.assertEqual(result, 'interrumpida')
                    reclaim.assert_called_once()
                    self.assertEqual(reclaim.call_args.args, (None, task['id']))
                    self.assertEqual(reclaim.call_args.kwargs['reason'], 'la API de Claude no respondía')
                    block.assert_not_called()
                    follow.assert_not_called(); notice.assert_not_called(); post.assert_not_called()
                    receipt = equipo.load(folder / 'receipt.json', {})
                    self.assertEqual(receipt['estado'], 'interrumpida')
                    self.assertIs(receipt['red'], True)
                    self.assertEqual(receipt['error'], 'la API de Claude no respondía: vuelve a la cola')
                    self.assertEqual(receipt['detalle'], error)
                    self.assertEqual(equipo.relaunch_note(receipt), '')
                    self.assertNotIn('veces', receipt)
                saved_red = equipo.load(folder / 'red.json', {})
                if veces == 3 and not reiniciar:
                    self.assertEqual(saved_red, red)
                else:
                    self.assertEqual(saved_red['veces'], 1 if reiniciar else (veces or 0) + 1)
                    self.assertIn('ultima', saved_red)
                    datetime.fromisoformat(saved_red['ultima'])

    def test_network_failure_requeues_the_first_three_times(self):
        for veces in (None, 1, 2):
            with self.subTest(veces=veces): self.run_network_failure(veces)

    def test_fourth_network_failure_blocks(self):
        self.run_network_failure(3)

    def test_network_failure_requeues_after_seven_hours(self):
        self.run_network_failure(3, (equipo.now() - timedelta(hours=7)).isoformat(timespec='seconds'), reiniciar=True)

    def test_fourth_network_failure_within_one_hour_blocks(self):
        self.run_network_failure(3, (equipo.now() - timedelta(hours=1)).isoformat(timespec='seconds'))

    def test_blocked_without_message_says_type_phase_and_attempt(self):
        self.assertEqual(self.run_blocked(RuntimeError(), {'fase': 'probando', 'intento': 2}),
                         'fallo sin mensaje (RuntimeError) en la fase probando, intento 2')

    def test_blocked_without_message_or_phase_file_says_only_the_type(self):
        self.assertEqual(self.run_blocked(RuntimeError()), 'fallo sin mensaje (RuntimeError)')

    def test_blocked_with_a_message_keeps_it_exactly(self):
        self.assertEqual(self.run_blocked(equipo.Stop('conflicto con otra tarea del equipo'), {'fase': 'probando', 'intento': 2}),
                         'conflicto con otra tarea del equipo')

    def execute_blocked(self, error):
        task = self.task({'lanzamiento': self.ficha})
        def raises(*a, **k): raise error
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            folder = state / 'runs' / task['id']; folder.mkdir(parents=True)
            (folder / 'fase.json').write_text(json.dumps({'fase': 'revisando', 'intento': 1}))
            with mock.patch.object(equipo, 'STATE', state), \
                 mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS', 'repo': tmp}), \
                 mock.patch.object(equipo, 'spec_of', lambda pid, t: {'titulo': 'Landing nueva'}), \
                 mock.patch.object(equipo, 'worktree', lambda *a, **k: Path(tmp) / 'wt'), mock.patch.object(equipo, 'git', lambda *a, **k: 'abc'), \
                 mock.patch.object(equipo, 'relaunch_note', lambda prev: ''), mock.patch.object(equipo, 'attempts', raises):
                with self.assertRaises(type(error)):
                    equipo.execute('owner-os', task, 'claim', 1)
            return equipo.load(folder / 'receipt.json', {})

    def test_execute_leaves_a_blocked_receipt_with_a_reason_when_the_error_has_no_text(self):
        receipt = self.execute_blocked(RuntimeError())
        self.assertEqual(receipt['estado'], 'bloqueada')
        self.assertEqual(receipt['error'], 'fallo sin mensaje (RuntimeError) en la fase revisando, intento 1')
        self.assertTrue(receipt['fin'])

    def test_execute_receipt_keeps_the_text_of_a_stop(self):
        receipt = self.execute_blocked(equipo.Stop('timeout al probar equipo (900 s)'))
        self.assertEqual(receipt['estado'], 'bloqueada')
        self.assertEqual(receipt['error'], 'timeout al probar equipo (900 s)')

    def test_notice_records_when_it_was_sent_and_posts_even_if_telegram_fails(self):
        posted = []
        def broken(text, botones=None): raise RuntimeError('Telegram caído')
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(equipo, 'STATE', Path(tmp)), \
             mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS'}), mock.patch.object(equipo, 'telegram', broken), \
             mock.patch.object(equipo, 'post', lambda *a, **k: posted.append(a)):
            with self.assertRaises(RuntimeError):
                equipo.avisar_lanzamiento('owner-os', self.task({'lanzamiento': self.ficha}))
            first = equipo.load(Path(tmp) / 'experimentos.json', {})['t_lanza']
            with self.assertRaises(RuntimeError):
                equipo.avisar_lanzamiento('owner-os', self.task({'lanzamiento': self.ficha}))
            again = equipo.load(Path(tmp) / 'experimentos.json', {})['t_lanza']
        self.assertEqual(len(posted), 2)
        self.assertEqual((first['proyecto'], first['titulo']), ('owner-os', 'Landing nueva'))
        self.assertTrue(first['avisado'])
        self.assertEqual(again['avisado'], first['avisado'])   # only the first notice sets the time

    def launched(self, tmp, spec=None, posted=None):
        task = self.task({'lanzamiento': self.ficha} if spec is None else spec)
        return [mock.patch.object(equipo, 'STATE', Path(tmp)), mock.patch.object(equipo, 'tasks', lambda pid, status=None: [task] if pid == 'owner-os' else []),
                mock.patch.object(equipo, 'post', lambda *a, **k: posted.append(a))]

    def test_launched_keeps_the_time_and_posts_once(self):
        posted = []
        with tempfile.TemporaryDirectory() as tmp:
            patches = self.launched(tmp, posted=posted)
            for p in patches: p.start()
            try:
                first = equipo.lanzado('t_lanza'); second = equipo.lanzado('t_lanza')
                saved = equipo.load(Path(tmp) / 'experimentos.json', {})['t_lanza']
            finally:
                for p in patches: p.stop()
        self.assertEqual((first['tarea'], first['proyecto'], first['titulo']), ('t_lanza', 'owner-os', 'Landing nueva'))
        self.assertTrue(first['lanzado'])
        self.assertEqual(second['lanzado'], first['lanzado'])
        self.assertEqual(saved['lanzado'], first['lanzado'])
        self.assertEqual(len(posted), 1)
        self.assertEqual(posted[0][:2], ('alfred', ['todos']))
        self.assertIn('Owner ha lanzado «Landing nueva»', posted[0][2])
        self.assertIn('Registros', posted[0][2]); self.assertIn('5 % de conversión', posted[0][2])

    def launch_with(self, *vias):
        with tempfile.TemporaryDirectory() as tmp:
            patches = self.launched(tmp, posted=[])
            for p in patches: p.start()
            try:
                for via in vias: equipo.lanzado('t_lanza', via)
                return equipo.load(Path(tmp) / 'experimentos.json', {})['t_lanza']
            finally:
                for p in patches: p.stop()

    def test_launched_keeps_where_it_was_marked(self):
        self.assertEqual(self.launch_with('telegram')['via'], 'telegram')
        self.assertEqual(self.launch_with('app')['via'], 'app')

    def test_launched_ignores_an_unknown_via(self):
        for via in ('x', '', None): self.assertNotIn('via', self.launch_with(via))

    def test_launched_again_with_another_via_keeps_the_first(self):
        self.assertEqual(self.launch_with('telegram', 'app')['via'], 'telegram')
        self.assertNotIn('via', self.launch_with(None, 'app'))

    def test_launched_keeps_the_notice_time(self):
        with tempfile.TemporaryDirectory() as tmp:
            equipo.save(Path(tmp) / 'experimentos.json', {'t_lanza': {'proyecto': 'owner-os', 'titulo': 'Landing nueva', 'avisado': '2026-10-15T08:00:00+02:00'}})
            patches = self.launched(tmp, posted=[])
            for p in patches: p.start()
            try: out = equipo.lanzado('t_lanza')
            finally:
                for p in patches: p.stop()
        self.assertEqual(out['avisado'], '2026-10-15T08:00:00+02:00')

    def test_launched_refuses_unknown_tasks_and_tasks_without_card(self):
        posted = []
        with tempfile.TemporaryDirectory() as tmp:
            patches = self.launched(tmp, {'porque': 'Sin ficha'}, posted)
            for p in patches: p.start()
            try:
                with self.assertRaisesRegex(equipo.Stop, 'tarea desconocida: t_nada'): equipo.lanzado('t_nada')
                with self.assertRaisesRegex(equipo.Stop, 'no tiene ficha de lanzamiento'): equipo.lanzado('t_lanza')
            finally:
                for p in patches: p.stop()
            self.assertFalse((Path(tmp) / 'experimentos.json').exists())
        self.assertEqual(posted, [])

    def test_board_shows_when_the_experiment_was_launched(self):
        def fake_tasks(pid, status=None):
            return [self.task({'lanzamiento': self.ficha}), {**self.task({'lanzamiento': self.ficha}), 'id': 't_otra'}] if pid == 'owner-os' else []
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(equipo, 'STATE', Path(tmp)), mock.patch.object(equipo, 'tasks', fake_tasks), mock.patch.object(equipo, 'post', lambda *a, **k: None), \
                 mock.patch.object(equipo, 'mesa_load', lambda: {'mensajes': []}), mock.patch.object(equipo, 'hermes_overview', lambda: {}):
                out = equipo.lanzado('t_lanza')
                items = {i['id']: i for i in equipo.tablero() if i['fuente'] == 'equipo'}
        self.assertEqual(items['t_lanza']['lanzado'], out['lanzado'])
        self.assertEqual(items['t_lanza']['lanzamiento'], self.ficha)
        self.assertNotIn('lanzado', items['t_otra'])

    def test_board_hides_a_half_filled_launch_card(self):
        half = {**self.ficha, 'umbral': ''}
        def fake_tasks(pid, status=None):
            return [self.task({'lanzamiento': self.ficha}), {**self.task({'lanzamiento': half}), 'id': 't_media'}] if pid == 'owner-os' else []
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(equipo, 'STATE', Path(tmp)), mock.patch.object(equipo, 'tasks', fake_tasks), mock.patch.object(equipo, 'post', lambda *a, **k: None), \
                 mock.patch.object(equipo, 'mesa_load', lambda: {'mensajes': []}), mock.patch.object(equipo, 'hermes_overview', lambda: {}):
                equipo.save(Path(tmp) / 'experimentos.json', {'t_media': {'lanzado': '2026-10-15T09:00:00+02:00'}})
                items = {i['id']: i for i in equipo.tablero() if i['fuente'] == 'equipo'}
        self.assertEqual(items['t_lanza']['lanzamiento'], self.ficha)
        self.assertNotIn('lanzamiento', items['t_media'])
        self.assertNotIn('lanzado', items['t_media'])

    def test_launched_command_without_task_explains_the_usage(self):
        logged = []
        with mock.patch.object(sys, 'argv', ['equipo.py', 'lanzado']), mock.patch.object(equipo, 'lanzado') as called, \
             mock.patch.object(equipo, 'log', lambda *parts: logged.append(' '.join(str(x) for x in parts))):
            with self.assertRaises(SystemExit) as cm: equipo.main()
        self.assertEqual(cm.exception.code, 2)
        called.assert_not_called()
        self.assertTrue(any('uso: equipo.py lanzado <id de tarea>' in line for line in logged))

    def test_alfred_prompt_knows_the_launch_and_result_commands(self):
        # Since 15/10 Owner's own instructions (team, experiments) live in his private profile, not in voice.ts.
        profile = Path.home() / 'Library/Application Support/com.lifeoperatingsystem.app/Workspace/perfil/instrucciones.md'
        if not profile.exists(): self.skipTest('sin el perfil privado de Owner en este Mac')
        text = profile.read_text()
        for cmd in ('lanzado', 'resultado'):
            self.assertIn(f'equipo.py {cmd}', text)

class TareaIdValida(unittest.TestCase):
    """The engine checks the task id with the same rule as the server (TAREA in equipo-acciones.ts)."""
    malos = ['', '../x', 't;rm', '--texto', '-abc', '_abc', 'a' * 81]
    medida = 'Medí 12 clics en 3 días'

    def task(self, tid):
        return {'id': tid, 'title': 'Landing nueva', 'status': 'ready', 'assignee': equipo.LANE, 'created_at': 1790000000,
                'body': json.dumps({'lanzamiento': LaunchNotice.ficha})}

    def test_bad_ids_are_refused_before_reading_any_board(self):
        for tid in self.malos:
            with self.subTest(tid=tid), mock.patch.object(equipo, 'tasks') as board:
                with self.assertRaisesRegex(equipo.Stop, 'Tarea no válida.'): equipo.lanzado(tid)
                with self.assertRaisesRegex(equipo.Stop, 'Tarea no válida.'): equipo.registrar_resultado('owner-os', self.medida, tid)
                board.assert_not_called()

    def test_good_ids_pass_the_validation(self):
        for tid in ('t_036cee09', 'a' * 80):
            with self.subTest(tid=tid), tempfile.TemporaryDirectory() as tmp, mock.patch.object(equipo, 'STATE', Path(tmp)), \
                 mock.patch.object(equipo, 'tasks', lambda pid, status=None, tid=tid: [self.task(tid)] if pid == 'owner-os' else []), \
                 mock.patch.object(equipo, 'post', lambda *a, **k: None):
                self.assertEqual(equipo.lanzado(tid)['tarea'], tid)
                self.assertEqual(equipo.registrar_resultado('owner-os', self.medida, tid)['tarea'], tid)

    def test_parser_knows_the_launch_and_result_commands(self):
        cmd = next(action for action in equipo.parser()._actions if action.dest == 'cmd')
        for name in ('lanzado', 'resultado'): self.assertIn(name, cmd.choices)
        a = equipo.parser().parse_args(['resultado', 'owner-os', '--texto', 'x', '--experimento', 't_1'])
        self.assertEqual((a.experimento, a.texto), ('t_1', 'x'))

    def test_parser_accepts_the_args_the_server_builds_for_a_launch(self):
        # Same args as lanzadoBoton() and experimentoArgs() in equipo-acciones.ts.
        for via in ('telegram', 'app'):
            a = equipo.parser().parse_args(['lanzado', 't_036cee09', '--via', via])
            self.assertEqual((a.cmd, a.project, a.via), ('lanzado', 't_036cee09', via))
        with mock.patch.object(sys, 'stderr', io.StringIO()), self.assertRaises(SystemExit): equipo.parser().parse_args(['lanzado', 't_036cee09', '--via', 'x'])

    def test_parser_accepts_the_decision_of_a_result(self):
        a = equipo.parser().parse_args(['resultado', 'owner-os', '--texto', 'Medí 12 clics', '--experimento', 't_036cee09', '--decision', 'parar'])
        self.assertEqual((a.cmd, a.project, a.experimento, a.decision), ('resultado', 'owner-os', 't_036cee09', 'parar'))
        self.assertIsNone(equipo.parser().parse_args(['resultado', 'owner-os', '--texto', 'Medí 12 clics']).decision)
        with mock.patch.object(sys, 'stderr', io.StringIO()), self.assertRaises(SystemExit):
            equipo.parser().parse_args(['resultado', 'owner-os', '--texto', 'Medí 12 clics', '--decision', 'x'])

class Descartar(unittest.TestCase):
    """Owner says why he will not launch an experiment: kept once, told to the mesa once, and undone if he launches it after all."""
    ficha = LaunchNotice.ficha
    motivo = 'No tengo tráfico para medirlo'

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name); self.posted = []
        self.ts = [{'id': 't_lanza', 'title': 'Landing nueva', 'status': 'done', 'created_at': 1790000000, 'body': json.dumps({'lanzamiento': self.ficha})},
                   {'id': 't_sin', 'title': 'Sin ficha', 'status': 'done', 'created_at': 1790000000, 'body': json.dumps({'porque': 'Sin ficha'})}]
        for patch in (mock.patch.object(equipo, 'STATE', self.state), mock.patch.object(equipo, 'tasks', lambda pid, status=None: self.ts if pid == 'owner-os' else []),
                      mock.patch.object(equipo, 'post', lambda *a, **k: self.posted.append(a))):
            patch.start(); self.addCleanup(patch.stop)

    def saved(self): return equipo.load(self.state / 'experimentos.json', {})

    def test_bad_ids_are_refused_before_reading_any_board(self):
        for tid in TareaIdValida.malos + [None, 7]:
            with self.subTest(tid=tid), mock.patch.object(equipo, 'tasks') as board:
                with self.assertRaisesRegex(equipo.Stop, 'Tarea no válida.'): equipo.descartar(tid, self.motivo)
                board.assert_not_called()
        self.assertEqual(self.posted, [])

    def test_unknown_task_and_task_without_card_are_refused(self):
        with self.assertRaisesRegex(equipo.Stop, 'tarea desconocida: t_nada'): equipo.descartar('t_nada', self.motivo)
        with self.assertRaisesRegex(equipo.Stop, 'esa tarea no tiene ficha de lanzamiento'): equipo.descartar('t_sin', self.motivo)
        self.assertFalse((self.state / 'experimentos.json').exists())
        self.assertEqual(self.posted, [])

    def test_a_launched_experiment_cannot_be_discarded(self):
        equipo.save(self.state / 'experimentos.json', {'t_lanza': {'proyecto': 'owner-os', 'lanzado': '2026-10-15T09:00:00+02:00'}})
        with self.assertRaisesRegex(equipo.Stop, 'ya está lanzado: apunta lo medido con equipo.py resultado'): equipo.descartar('t_lanza', self.motivo)
        self.assertNotIn('descartado', self.saved()['t_lanza'])
        self.assertEqual(self.posted, [])

    def test_the_reason_needs_the_minimum_length_after_trimming(self):
        for corto in ('', None, '   ', 'x' * (equipo.RESULTADO_MIN - 1), '  ' + 'x' * (equipo.RESULTADO_MIN - 1) + '  '):
            with self.subTest(motivo=corto), self.assertRaisesRegex(equipo.Stop, f'cuenta por qué no lo lanzas \\(mínimo {equipo.RESULTADO_MIN} caracteres\\)'):
                equipo.descartar('t_lanza', corto)
        self.assertFalse((self.state / 'experimentos.json').exists())
        out = equipo.descartar('t_lanza', '  ' + 'x' * equipo.RESULTADO_MIN + '  ')
        self.assertEqual(out['motivo'], 'x' * equipo.RESULTADO_MIN)

    def test_it_keeps_the_reason_cut_to_the_maximum_and_tells_the_mesa(self):
        equipo.save(self.state / 'experimentos.json', {'t_lanza': {'proyecto': 'owner-os', 'titulo': 'Landing nueva', 'avisado': '2026-10-15T08:00:00+02:00'}})
        out = equipo.descartar('t_lanza', 'y' * (equipo.RESULTADO_MAX + 50))
        saved = self.saved()['t_lanza']
        self.assertEqual(set(out), {'tarea', 'proyecto', 'titulo', 'descartado', 'motivo'})
        self.assertEqual((out['tarea'], out['proyecto'], out['titulo']), ('t_lanza', 'owner-os', 'Landing nueva'))
        self.assertEqual(len(out['motivo']), equipo.RESULTADO_MAX)
        self.assertEqual((saved['descartado'], saved['motivo'], saved['avisado']), (out['descartado'], out['motivo'], '2026-10-15T08:00:00+02:00'))
        self.assertEqual((saved['proyecto'], saved['titulo']), ('owner-os', 'Landing nueva'))
        self.assertEqual(datetime.fromisoformat(saved['descartado']).microsecond, 0)
        self.assertEqual(len(self.posted), 1)
        self.assertEqual(self.posted[0][:2], ('alfred', ['todos']))
        self.assertEqual(self.posted[0][2], f"Owner descarta «Landing nueva» sin lanzarlo: {out['motivo']}")
        self.assertEqual(self.posted[0][3:], ('aviso', 'owner-os'))

    def test_it_is_idempotent_and_posts_once(self):
        first = equipo.descartar('t_lanza', self.motivo)
        before = (self.state / 'experimentos.json').read_text()
        second = equipo.descartar('t_lanza', 'Otro motivo distinto del primero')
        self.assertEqual(second, first)
        self.assertEqual(second['motivo'], self.motivo)
        self.assertEqual((self.state / 'experimentos.json').read_text(), before)
        self.assertEqual(len(self.posted), 1)

    def test_launching_afterwards_removes_the_discard(self):
        equipo.descartar('t_lanza', self.motivo)
        out = equipo.lanzado('t_lanza')
        saved = self.saved()['t_lanza']
        self.assertNotIn('descartado', saved); self.assertNotIn('motivo', saved)
        self.assertEqual((saved['lanzado'], saved['proyecto'], saved['titulo']), (out['lanzado'], 'owner-os', 'Landing nueva'))
        self.assertEqual(len(self.posted), 2)
        self.assertIn('Owner ha lanzado «Landing nueva»', self.posted[1][2])
        self.assertEqual(equipo.experimentos('owner-os')['descartados'], 0)

    def test_board_keeps_an_old_undecided_experiment_for_owner_and_files_the_discarded_one(self):
        old, recent = equipo.time.time() - 10 * 86400, equipo.time.time()
        def task(tid, completed_at, spec=None):
            return {'id': tid, 'title': tid, 'status': 'done', 'created_at': 1790000000, 'completed_at': completed_at, 'body': json.dumps(spec or {'lanzamiento': self.ficha})}
        self.ts = [task('t_vieja_sin_lanzar', old), task('t_descartada', recent), task('t_descartada_vieja', old), task('t_sin_ficha_vieja', old, {'porque': 'Sin ficha'})]
        equipo.save(self.state / 'experimentos.json', {
            't_descartada': {'proyecto': 'owner-os', 'descartado': '2026-10-15T09:00:00+02:00', 'motivo': self.motivo},
            't_descartada_vieja': {'proyecto': 'owner-os', 'descartado': '2026-10-05T09:00:00+02:00', 'motivo': self.motivo}})
        with mock.patch.object(equipo, 'mesa_load', lambda: {'mensajes': []}), mock.patch.object(equipo, 'hermes_overview', lambda: {}):
            items = {i['id']: i for i in equipo.tablero() if i['fuente'] == 'equipo'}
        vieja = items['t_vieja_sin_lanzar']
        self.assertEqual((vieja['columna'], vieja['responsable'], vieja['fase']), ('para-ti', 'owner', 'lista para lanzar'))
        hecha = items['t_descartada']
        self.assertEqual((hecha['columna'], hecha['responsable'], hecha['fase']), ('hecho', 'product', 'descartado'))
        self.assertEqual((hecha['descartado'], hecha['descarte']), ('2026-10-15T09:00:00+02:00', self.motivo))
        self.assertNotIn('motivo', hecha)
        self.assertNotIn('t_descartada_vieja', items)   # the usual 7-day cut applies to a discarded one
        self.assertNotIn('t_sin_ficha_vieja', items)

    def test_board_returns_a_discarded_task_to_owner_once_launched(self):
        self.ts = [{'id': 't_lanza', 'title': 'Landing nueva', 'status': 'done', 'created_at': 1790000000, 'completed_at': equipo.time.time(), 'body': json.dumps({'lanzamiento': self.ficha})}]
        equipo.descartar('t_lanza', self.motivo)
        equipo.lanzado('t_lanza')
        with mock.patch.object(equipo, 'mesa_load', lambda: {'mensajes': []}), mock.patch.object(equipo, 'hermes_overview', lambda: {}):
            item = next(i for i in equipo.tablero() if i['id'] == 't_lanza')
        self.assertEqual((item['columna'], item['fase']), ('hecho', 'hecha'))   # no commit in its receipt: just done
        self.assertNotIn('descartado', item); self.assertNotIn('descarte', item)
        self.assertTrue(item['lanzado'])

    def test_discard_command_calls_descartar_with_the_task_and_the_reason(self):
        argv = ['equipo.py', 'descartar', 't_036cee09', '--texto', 'No tengo tráfico para medirlo']
        with mock.patch.object(sys, 'argv', argv), mock.patch.object(equipo, 'descartar', return_value={'tarea': 't_036cee09'}) as called, \
             mock.patch('builtins.print') as shown:
            equipo.main()
        called.assert_called_once_with('t_036cee09', 'No tengo tráfico para medirlo')
        self.assertIn('t_036cee09', shown.call_args[0][0])

    def test_discard_command_without_task_explains_the_usage(self):
        logged = []
        with mock.patch.object(sys, 'argv', ['equipo.py', 'descartar']), mock.patch.object(equipo, 'descartar') as called, \
             mock.patch.object(equipo, 'log', lambda *parts: logged.append(' '.join(str(x) for x in parts))):
            with self.assertRaises(SystemExit) as cm: equipo.main()
        self.assertEqual(cm.exception.code, 2)
        called.assert_not_called()
        self.assertTrue(any('uso: equipo.py descartar <id de tarea> --texto <motivo>' in line for line in logged))

    def test_parser_knows_the_discard_command(self):
        cmd = next(action for action in equipo.parser()._actions if action.dest == 'cmd')
        self.assertIn('descartar', cmd.choices)
        a = equipo.parser().parse_args(['descartar', 't_1', '--texto', 'por qué no'])
        self.assertEqual((a.project, a.texto), ('t_1', 'por qué no'))

class Experimentos(unittest.TestCase):
    """What Owner measured in a launched experiment is kept per project and read by the planner."""
    ficha = {'que': 'Landing A/B', 'a_quien': 'Tráfico frío', 'metrica': 'Registros', 'umbral': '5 % de conversión'}

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.state = Path(self.tmp.name) / 'state'
        self.ts = [{'id': 't_exp', 'title': 'Landing nueva', 'status': 'done', 'body': json.dumps({'lanzamiento': self.ficha})},
                   {'id': 't_sin', 'title': 'Sin ficha', 'status': 'done', 'body': None}]
        self.patches = [mock.patch.object(equipo, 'STATE', self.state), mock.patch.object(equipo, 'tasks', lambda pid, status=None: self.ts),
                        mock.patch.object(equipo, 'lessons_text', lambda pid, role: ''), mock.patch.object(equipo, 'mesa_load', lambda date=None: {'mensajes': []}),
                        mock.patch.object(equipo, 'metrics', lambda pid, days=7: {'tareas': 0})]
        for patch in self.patches: patch.start()

    def tearDown(self):
        for patch in self.patches: patch.stop()
        self.tmp.cleanup()

    def saved(self): return equipo.load(self.state / 'experimentos' / 'owner-os.json', [])

    def test_result_with_task_keeps_title_and_card(self):
        out = equipo.registrar_resultado('owner-os', '  42 registros de 600 visitas (7 %)  ', 't_exp')
        self.assertEqual((out['titulo'], out['lanzamiento'], out['tarea']), ('Landing nueva', self.ficha, 't_exp'))
        self.assertEqual(out['texto'], '42 registros de 600 visitas (7 %)')
        self.assertEqual(self.saved(), [out])

    def test_result_without_task_is_kept_without_empty_keys(self):
        out = equipo.registrar_resultado('owner-os', 'Probé el aviso a mano y nadie lo abrió')
        self.assertEqual(set(out), {'fecha', 'hora', 'texto'})
        out2 = equipo.registrar_resultado('owner-os', 'Resultado de una tarea sin ficha', 't_sin')
        self.assertEqual((out2['titulo'], 'lanzamiento' in out2), ('Sin ficha', False))
        self.assertEqual(self.saved(), [out, out2])

    def test_valid_decision_is_kept_and_an_invalid_one_writes_nothing(self):
        for decision in equipo.DECISIONES:
            self.assertEqual(equipo.registrar_resultado('owner-os', 'Convirtió el 7 % frente al 5 % esperado', 't_exp', decision)['decision'], decision)
        self.assertEqual([r['decision'] for r in self.saved()], list(equipo.DECISIONES))
        self.assertNotIn('decision', equipo.registrar_resultado('owner-os', 'Convirtió el 7 % frente al 5 % esperado', 't_exp', ''))
        self.assertNotIn('decision', equipo.registrar_resultado('owner-os', 'Convirtió el 7 % frente al 5 % esperado', 't_exp', None))
        self.assertEqual(set(equipo.registrar_resultado('owner-os', 'Probé el aviso a mano y nadie lo abrió')), {'fecha', 'hora', 'texto'})
        before = self.saved()
        with self.assertRaisesRegex(equipo.Stop, 'Decisión no válida: usa seguir, cambiar o parar.'):
            equipo.registrar_resultado('owner-os', 'Convirtió el 7 % frente al 5 % esperado', 't_exp', 'quizá')
        self.assertEqual(self.saved(), before)

    def test_invalid_decision_does_not_create_the_file(self):
        with self.assertRaises(equipo.Stop): equipo.registrar_resultado('owner-os', 'Convirtió el 7 % frente al 5 % esperado', 't_exp', 'quizá')
        self.assertFalse((self.state / 'experimentos').exists())

    def test_planner_signals_name_the_stopped_and_changed_lines(self):
        equipo.registrar_resultado('owner-os', 'Solo 2 registros de 600 visitas', 't_exp', 'parar')
        equipo.registrar_resultado('owner-os', 'Probé el aviso a mano y nadie lo abrió', None, 'cambiar')
        equipo.registrar_resultado('owner-os', 'Convirtió el 7 % frente al 5 % esperado', 't_sin', 'seguir')
        signals = equipo.planner_signals('owner-os')
        self.assertIn('Owner decidió parar: «Landing nueva». No propongas más experimentos de esa línea.', signals)
        self.assertIn('Owner pidió cambiar: «Probé el aviso a mano y nadie lo abrió». Propón una variante con otra hipótesis u otro público, no la misma.', signals)
        titulo_seguir = next(r['titulo'] for r in equipo.resultados('owner-os') if r.get('tarea') == 't_sin')
        self.assertIn(f'Owner decidió seguir: «{titulo_seguir}». Propón el siguiente paso de esa línea (más alcance, otro canal o la siguiente fase: contenido → oferta → producto) con su ficha de lanzamiento; no repitas el mismo experimento.', signals)
        self.assertIn('"decision": "seguir"', signals)

    def test_planner_signals_with_only_follow_adds_follow_line(self):
        equipo.registrar_resultado('owner-os', 'Convirtió el 7 % frente al 5 % esperado', 't_exp', 'seguir')
        signals = equipo.planner_signals('owner-os')
        self.assertIn('Owner decidió seguir: «Landing nueva». Propón el siguiente paso de esa línea (más alcance, otro canal o la siguiente fase: contenido → oferta → producto) con su ficha de lanzamiento; no repitas el mismo experimento.', signals)
        self.assertNotIn('Owner decidió parar', signals)
        self.assertNotIn('Owner pidió cambiar', signals)

    def test_bad_input_stops_and_writes_nothing(self):
        for args in (('owner-os', 'corto'), ('owner-os', '          '), ('inventado', 'texto suficientemente largo'),
                     ('owner-os', 'texto suficientemente largo', 't_no_existe')):
            with self.assertRaises(equipo.Stop): equipo.registrar_resultado(*args)
        self.assertFalse((self.state / 'experimentos').exists())

    def test_only_the_last_30_are_kept_and_text_is_cut(self):
        for n in range(35): equipo.registrar_resultado('owner-os', f'resultado número {n:02d} ' + 'x' * 700)
        kept = self.saved()
        self.assertEqual(len(kept), 30)
        self.assertTrue(kept[0]['texto'].startswith('resultado número 05'))
        self.assertTrue(all(len(r['texto']) == 600 for r in kept))

    def test_planner_signals_status_and_brief_read_them(self):
        equipo.registrar_resultado('owner-os', 'Convirtió el 7 % frente al 5 % esperado', 't_exp')
        signals = equipo.planner_signals('owner-os')
        self.assertIn('Resultados de experimentos que Owner ha medido', signals)
        self.assertIn('Convirtió el 7 % frente al 5 % esperado', signals)
        self.assertIn('Landing nueva', signals)
        self.assertNotIn('Resultados de experimentos', equipo.planner_signals('alfa'))
        with mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS', 'goal': 'g'}), mock.patch.object(equipo, 'lessons', lambda pid: []), \
             mock.patch.object(equipo, 'ficha', lambda pid: None):
            brief = equipo.project_brief('owner-os')
        self.assertEqual([r['titulo'] for r in brief['experimentos']], ['Landing nueva'])

class Decidir(unittest.TestCase):
    ahora = datetime.fromisoformat('2026-10-19T12:00:00+02:00')
    tid = 't_036cee09'

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)
        self.path = self.state / 'experimentos' / 'owner-os.json'
        self.post = mock.Mock()
        ficha = {'que': 'Landing', 'a_quien': 'Frío', 'metrica': 'Registros', 'umbral': '5 %'}
        ts = [{'id': self.tid, 'title': 'Landing nueva', 'status': 'ready', 'body': json.dumps({'lanzamiento': ficha})}]
        patches = [mock.patch.object(equipo, 'STATE', self.state), mock.patch.object(equipo, 'now', lambda: self.ahora),
                   mock.patch.object(equipo, 'tasks', lambda pid: ts if pid == 'owner-os' else []),
                   mock.patch.object(equipo, 'hermes_overview', lambda: {}),
                   mock.patch.object(equipo, 'mesa_load', lambda: {'mensajes': []}), mock.patch.object(equipo, 'post', self.post)]
        for patch in patches: patch.start(); self.addCleanup(patch.stop)

    def test_updates_only_latest_result_and_tablero_reads_decision(self):
        anterior = {'tarea': self.tid, 'titulo': 'Landing anterior', 'texto': 'Dos registros', 'decision': 'cambiar'}
        ultimo = {'tarea': self.tid, 'titulo': 'Landing nueva', 'texto': 'Siete registros'}
        otro = {'tarea': 't_otra', 'texto': 'Otro experimento'}
        equipo.save(self.path, [anterior, ultimo, otro])
        found = equipo.decidir(self.tid, 'seguir')
        self.assertEqual(found, {'tarea': self.tid, 'proyecto': 'owner-os', 'titulo': 'Landing nueva', 'decision': 'seguir'})
        self.assertEqual(equipo.resultados('owner-os'), [anterior, {**ultimo, 'decision': 'seguir', 'decidido': self.ahora.isoformat(timespec='seconds')}, otro])
        self.post.assert_called_once_with('alfred', ['todos'], 'Owner decide seguir en «Landing nueva».', 'aviso', 'owner-os')
        item = next(i for i in equipo.tablero() if i['id'] == self.tid)
        self.assertEqual(item['decision'], 'seguir')

    def test_existing_decision_leaves_file_unchanged(self):
        for decision in equipo.DECISIONES:
            with self.subTest(decision=decision):
                equipo.save(self.path, [{'tarea': self.tid}, {'tarea': self.tid, 'decision': decision}])
                before = self.path.read_bytes()
                with self.assertRaisesRegex(equipo.Stop, '^ese resultado ya tiene decisión$'):
                    equipo.decidir(self.tid, 'seguir')
                self.assertEqual(self.path.read_bytes(), before)
        self.post.assert_not_called()

    def test_task_without_result_is_rejected(self):
        with self.assertRaisesRegex(equipo.Stop, '^ese experimento no tiene resultado apuntado: usa equipo.py resultado$'):
            equipo.decidir(self.tid, 'seguir')
        self.assertFalse(self.path.exists())
        self.post.assert_not_called()

    def test_invalid_task_and_decision_are_rejected(self):
        for tid in ('../x', '-abc'):
            with self.subTest(tid=tid), self.assertRaisesRegex(equipo.Stop, '^Tarea no válida\\.$'):
                equipo.decidir(tid, 'seguir')
        with self.assertRaisesRegex(equipo.Stop, '^Decisión no válida: usa seguir, cambiar o parar\\.$'):
            equipo.decidir(self.tid, 'quizá')
        self.assertFalse(self.path.exists())
        self.post.assert_not_called()

    def test_parser_accepts_decidir(self):
        args = equipo.parser().parse_args(['decidir', 't_036cee09', '--decision', 'seguir'])
        self.assertEqual((args.cmd, args.project, args.decision), ('decidir', 't_036cee09', 'seguir'))

class LanzamientosMedidos(unittest.TestCase):
    """The planner, the mesa and the status see how many announced experiments Owner launched and how long it took."""
    ahora = datetime.fromisoformat('2026-10-15T12:00:00+02:00')

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)
        patches = [mock.patch.object(equipo, 'STATE', self.state), mock.patch.object(equipo, 'now', lambda: self.ahora),
                   mock.patch.object(equipo, 'lessons_text', lambda pid, role: ''), mock.patch.object(equipo, 'mesa_load', lambda date=None: {'mensajes': []}),
                   mock.patch.object(equipo, 'metrics', lambda pid, days=7: {'tareas': 0})]
        for patch in patches: patch.start(); self.addCleanup(patch.stop)

    def registro(self):
        equipo.save(self.state / 'experimentos.json', {
            't_a': {'proyecto': 'owner-os', 'avisado': '2026-10-14T08:00:00+02:00', 'lanzado': '2026-10-14T11:00:00+02:00'},
            't_b': {'proyecto': 'owner-os', 'avisado': '2026-10-15T09:00:00+02:00'},
            't_c': {'proyecto': 'alfa', 'avisado': '2026-10-14T08:00:00+02:00', 'lanzado': '2026-10-14T09:00:00+02:00'},
            't_d': {'proyecto': 'owner-os', 'avisado': '2026-10-05T08:00:00+02:00', 'lanzado': '2026-10-05T10:00:00+02:00'}})

    def test_counts_only_this_project_in_the_window(self):
        self.registro()
        self.assertEqual(equipo.experimentos('owner-os'), {'avisados': 2, 'lanzados': 1, 'lanzados_por_via': {'telegram': 0, 'app': 0, 'otra': 1}, 'horas_hasta_lanzar': 3.0,
                                                           'avisados_sin_fusionar': 0, 'fusionados_24h': 0,
                                                           'sin_medir': [{'tarea': 't_a', 'titulo': 't_a'}],
                                                           'recordados': 0, 'medidos_tras_recordar': 0,
                                                           'recordados_lanzar': 0, 'decididos_tras_recordar_lanzar': 0, 'por_lanzar_total': 1,
                                                           'decisiones': {'seguir': 0, 'cambiar': 0, 'parar': 0, 'sin_decision': 0}, 'seguir_con_siguiente': 0,
                                                           'por_lanzar': [{'tarea': 't_b', 'titulo': 't_b', 'avisado': '2026-10-15T09:00:00+02:00'}],
                                                           'descartados': 0, 'motivos_descarte': []})

    def test_without_record_returns_zeros(self):
        self.assertEqual(equipo.experimentos('owner-os'), {'avisados': 0, 'lanzados': 0, 'lanzados_por_via': {'telegram': 0, 'app': 0, 'otra': 0}, 'horas_hasta_lanzar': None, 'sin_medir': [],
                                                           'avisados_sin_fusionar': 0, 'fusionados_24h': 0,
                                                           'recordados': 0, 'medidos_tras_recordar': 0, 'por_lanzar': [],
                                                           'recordados_lanzar': 0, 'decididos_tras_recordar_lanzar': 0, 'por_lanzar_total': 0,
                                                           'decisiones': {'seguir': 0, 'cambiar': 0, 'parar': 0, 'sin_decision': 0}, 'seguir_con_siguiente': 0,
                                                           'descartados': 0, 'motivos_descarte': []})

    def test_counts_unmerged_notices_and_merges_within_24_hours(self):
        notice = self.ahora - timedelta(days=2)
        entry = {'proyecto': 'owner-os', 'avisado': notice.isoformat(), 'sin_fusionar': True}
        for fusionado in ((notice + timedelta(hours=30)).isoformat(), 'rota', None,
                          (notice - timedelta(seconds=1)).isoformat(), '2026-10-14T08:00:00'):
            with self.subTest(fusionado=fusionado):
                equipo.save(self.state / 'experimentos.json', {
                    't_a': {**entry, 'fusionado': (notice + timedelta(hours=24)).isoformat()},
                    't_b': {**entry, 'fusionado': fusionado},
                    't_rota': {**entry, 'avisado': 'rota'},
                    't_vieja': {**entry, 'avisado': (self.ahora - timedelta(days=8)).isoformat()},
                    't_futura': {**entry, 'avisado': (self.ahora + timedelta(days=1)).isoformat()},
                    't_otro': {**entry, 'proyecto': 'alfa'},
                    't_fusionada': {**entry, 'sin_fusionar': False, 'fusionado': notice.isoformat()}})
                found = equipo.experimentos('owner-os')
                self.assertEqual(found['avisados_sin_fusionar'], 2)
                self.assertEqual(found['fusionados_24h'], 1)

    def test_por_lanzar_total_counts_all_seven_pending_before_the_cap(self):
        equipo.save(self.state / 'experimentos.json', {
            f't_{n}': {'proyecto': 'owner-os', 'avisado': f'2026-10-14T0{n}:00:00+02:00'} for n in range(7)})
        with mock.patch.object(equipo, 'lanzamientos', wraps=equipo.lanzamientos) as read:
            found = equipo.experimentos('owner-os')
        read.assert_called_once_with()
        self.assertEqual(found['por_lanzar_total'], 7)
        self.assertEqual(len(found['por_lanzar']), 5)

    def test_launch_reminders_count_decisions_within_72_hours(self):
        equipo.save(self.state / 'experimentos.json', {
            't_a': {'proyecto': 'owner-os', 'recordado_lanzar': '2026-10-10T08:00:00+02:00', 'lanzado': '2026-10-10T18:00:00+02:00'},
            't_b': {'proyecto': 'owner-os', 'recordado_lanzar': '2026-10-10T08:00:00+02:00', 'descartado': '2026-10-13T16:00:00+02:00'},
            't_otro': {'proyecto': 'alfa', 'recordado_lanzar': '2026-10-10T08:00:00+02:00'},
            't_viejo': {'proyecto': 'owner-os', 'recordado_lanzar': '2026-10-05T08:00:00+02:00'},
            't_roto': {'proyecto': 'owner-os', 'recordado_lanzar': 'rota'}})
        found = equipo.experimentos('owner-os')
        self.assertEqual(found['recordados_lanzar'], 2)
        self.assertEqual(found['decididos_tras_recordar_lanzar'], 1)
        self.assertEqual(equipo.experimentos('owner-os', days=2)['recordados_lanzar'], 0)

    def test_launch_reminders_ignore_invalid_decision_dates_and_count_each_entry_once(self):
        base = {'proyecto': 'owner-os', 'recordado_lanzar': '2026-10-10T08:00:00+02:00'}
        equipo.save(self.state / 'experimentos.json', {
            't_roto': {**base, 'lanzado': 'rota'},
            't_antes': {**base, 'descartado': '2026-10-10T07:00:00+02:00'},
            't_limite': {**base, 'lanzado': '2026-10-10T08:00:00+02:00', 'descartado': '2026-10-13T08:00:00+02:00'},
            't_72': {**base, 'descartado': '2026-10-13T08:00:00+02:00'}})
        found = equipo.experimentos('owner-os')
        self.assertEqual(found['recordados_lanzar'], 4)
        self.assertEqual(found['decididos_tras_recordar_lanzar'], 2)

    def test_planner_signals_launch_reminders_only_when_present(self):
        self.assertNotIn('Recordatorios de lanzar', equipo.planner_signals('owner-os'))
        base = equipo.experimentos('owner-os')
        for count in (2, 5):
            with self.subTest(count=count), mock.patch.object(equipo, 'experimentos', return_value={
                    **base, 'recordados_lanzar': count, 'decididos_tras_recordar_lanzar': 1}):
                text = equipo.planner_signals('owner-os')
            self.assertIn(f'Recordatorios de lanzar (7 días): {count} enviados, 1 lanzados o descartados en 72 h.', text)
            self.assertEqual('Con menos de 5 no es señal.' in text, count < 5)

    def test_decisiones_count_the_results_of_the_window_by_what_owner_decided(self):
        equipo.save(self.state / 'experimentos' / 'owner-os.json', [
            {'hora': '2026-10-15T09:00:00+02:00', 'texto': 'Solo 2 registros de 600 visitas', 'decision': 'parar'},
            {'hora': '2026-10-15T10:00:00+02:00', 'texto': 'Convirtió el 7 % frente al 5 %', 'decision': 'seguir'},
            {'hora': '2026-10-15T11:00:00+02:00', 'texto': 'Nadie abrió el aviso'},
            {'hora': '2026-10-15T11:30:00+02:00', 'texto': 'Decisión inválida', 'decision': 'x'},
            {'hora': 'rota', 'texto': 'Hora rota', 'decision': 'seguir'},
            {'hora': '2026-10-05T09:00:00+02:00', 'texto': 'Hace diez días', 'decision': 'cambiar'}])
        self.assertEqual(equipo.experimentos('owner-os')['decisiones'], {'seguir': 1, 'cambiar': 0, 'parar': 1, 'sin_decision': 2})

    def test_planner_signals_line_for_decisions_asks_the_mesa_only_when_some_are_missing(self):
        base = equipo.experimentos('owner-os')
        def with_decisiones(**d):
            return mock.patch.object(equipo, 'experimentos', lambda pid, days=7: {**base, 'decisiones': {'seguir': 0, 'cambiar': 0, 'parar': 0, 'sin_decision': 0, **d}})
        with with_decisiones():
            self.assertNotIn('Resultados apuntados', equipo.planner_signals('owner-os'))
        with with_decisiones(seguir=1, parar=1, sin_decision=2):
            signals = equipo.planner_signals('owner-os')
        self.assertIn('Resultados apuntados (7 días): 4, con decisión 2. Pide a Owner en la mesa si sigue, cambia o para antes de proponer el siguiente experimento de esa línea.', signals)
        with with_decisiones(seguir=2):
            signals = equipo.planner_signals('owner-os')
        self.assertIn('Resultados apuntados (7 días): 2, con decisión 2.', signals)
        self.assertNotIn('si sigue, cambia o para', signals)

    def test_discarded_leave_por_lanzar_and_are_counted_with_their_reason_latest_first(self):
        equipo.save(self.state / 'experimentos.json', {
            't_b': {'proyecto': 'owner-os', 'titulo': 'Pendiente', 'avisado': '2026-10-15T09:00:00+02:00'},
            't_x': {'proyecto': 'owner-os', 'titulo': 'Descartada ayer', 'avisado': '2026-10-13T08:00:00+02:00', 'descartado': '2026-10-14T10:00:00+02:00', 'motivo': 'No tengo tráfico para medirlo'},
            't_y': {'proyecto': 'owner-os', 'titulo': 'Descartada hoy', 'avisado': '2026-10-14T08:00:00+02:00', 'descartado': '2026-10-15T09:00:00+02:00', 'motivo': 'Cuesta más de lo que vale'},
            't_otro': {'proyecto': 'alfa', 'titulo': 'De otro proyecto', 'avisado': '2026-10-14T08:00:00+02:00', 'descartado': '2026-10-15T09:00:00+02:00', 'motivo': 'No es de este proyecto'},
            't_vieja': {'proyecto': 'owner-os', 'titulo': 'Fuera de la ventana', 'avisado': '2026-10-05T08:00:00+02:00', 'descartado': '2026-10-06T09:00:00+02:00', 'motivo': 'Muy antigua para contar'}})
        found = equipo.experimentos('owner-os')
        self.assertEqual([x['tarea'] for x in found['por_lanzar']], ['t_b'])
        self.assertEqual((found['avisados'], found['lanzados'], found['descartados']), (3, 0, 2))
        self.assertEqual(found['motivos_descarte'], [{'tarea': 't_y', 'titulo': 'Descartada hoy', 'motivo': 'Cuesta más de lo que vale'},
                                                     {'tarea': 't_x', 'titulo': 'Descartada ayer', 'motivo': 'No tengo tráfico para medirlo'}])

    def test_motivos_descarte_are_capped_at_five_and_a_launched_one_is_not_discarded(self):
        registro = {f't_{n}': {'proyecto': 'owner-os', 'titulo': f'Exp {n}', 'avisado': '2026-10-13T08:00:00+02:00',
                               'descartado': f'2026-10-14T0{n}:00:00+02:00', 'motivo': f'motivo número {n}'} for n in range(7)}
        registro['t_lanzada'] = {'proyecto': 'owner-os', 'avisado': '2026-10-13T08:00:00+02:00', 'lanzado': '2026-10-14T12:00:00+02:00', 'descartado': '2026-10-14T23:00:00+02:00'}
        equipo.save(self.state / 'experimentos.json', registro)
        found = equipo.experimentos('owner-os')
        self.assertEqual(found['descartados'], 7)
        self.assertEqual([x['tarea'] for x in found['motivos_descarte']], ['t_6', 't_5', 't_4', 't_3', 't_2'])
        self.assertEqual(found['lanzados'], 1)

    def test_planner_signals_name_the_discard_reasons(self):
        self.assertNotIn('Owner descartó sin lanzar', equipo.planner_signals('owner-os'))
        equipo.save(self.state / 'experimentos.json', {
            't_x': {'proyecto': 'owner-os', 'titulo': 'Landing vieja', 'avisado': '2026-10-14T08:00:00+02:00', 'descartado': '2026-10-14T10:00:00+02:00', 'motivo': 'No tengo tráfico para medirlo'}})
        text = equipo.planner_signals('owner-os')
        self.assertIn('Owner descartó sin lanzar: «Landing vieja» (No tengo tráfico para medirlo). No propongas otro experimento con ese mismo freno.', text)
        self.assertNotIn('Avisados hace más de 48 h', text)
        self.assertNotIn('Owner descartó sin lanzar', equipo.planner_signals('alfa'))

    def test_por_lanzar_is_oldest_notice_first_capped_at_five_and_inside_the_window(self):
        avisos = {f't_{n}': {'proyecto': 'owner-os', 'titulo': f'Exp {n}', 'avisado': f'2026-10-1{n + 1}T08:00:00+02:00'} for n in range(2)}
        avisos.update({f't_n{n}': {'proyecto': 'owner-os', 'avisado': f'2026-10-14T0{n}:00:00+02:00'} for n in range(1, 7)})
        avisos['t_vieja'] = {'proyecto': 'owner-os', 'avisado': '2026-10-05T08:00:00+02:00'}
        avisos['t_rota'] = {'proyecto': 'owner-os', 'avisado': 'rota'}
        equipo.save(self.state / 'experimentos.json', dict(reversed(list(avisos.items()))))
        found = equipo.experimentos('owner-os')['por_lanzar']
        self.assertEqual([x['tarea'] for x in found], ['t_0', 't_1', 't_n1', 't_n2', 't_n3'])
        self.assertEqual(found[0], {'tarea': 't_0', 'titulo': 'Exp 0', 'avisado': '2026-10-11T08:00:00+02:00'})
        self.assertEqual(equipo.experimentos('owner-os')['avisados'], 8)   # t_0, t_1 and t_n1..t_n6; t_vieja (10 days old) and t_rota do not count

    def test_planner_names_only_notices_older_than_48_hours_without_launch(self):
        equipo.save(self.state / 'experimentos.json', {
            't_vieja': {'proyecto': 'owner-os', 'titulo': 'Landing vieja', 'avisado': '2026-10-13T10:00:00+02:00'},   # 50 h
            't_nueva': {'proyecto': 'owner-os', 'titulo': 'Landing nueva', 'avisado': '2026-10-15T02:00:00+02:00'}})  # 10 h
        text = equipo.planner_signals('owner-os')
        self.assertIn('Avisados hace más de 48 h y sin lanzar: «Landing vieja».', text)
        self.assertNotIn('Landing nueva»', text.split('Avisados hace más de 48 h')[1])

    def test_planner_has_no_waiting_line_without_old_notices(self):
        equipo.save(self.state / 'experimentos.json', {
            't_nueva': {'proyecto': 'owner-os', 'titulo': 'Landing nueva', 'avisado': '2026-10-15T02:00:00+02:00'},
            't_lanzada': {'proyecto': 'owner-os', 'titulo': 'Vieja lanzada', 'avisado': '2026-10-13T10:00:00+02:00', 'lanzado': '2026-10-13T12:00:00+02:00'}})
        self.assertNotIn('Avisados hace más de 48 h', equipo.planner_signals('owner-os'))

    def test_tablero_reads_lanzamientos_once_with_two_cards(self):
        ficha = {'que': 'Landing', 'a_quien': 'Frío', 'metrica': 'Registros', 'umbral': '5 %'}
        ts = [{'id': f't_{n}', 'title': f'Tarea {n}', 'status': 'ready', 'body': json.dumps({'lanzamiento': ficha})} for n in range(2)]
        config = {**equipo.CONFIG, 'projects': {'owner-os': equipo.CONFIG['projects']['owner-os']}}
        calls = []
        def leer():
            calls.append(1); return {'t_0': {'lanzado': '2026-10-15T10:00:00+02:00'}}
        with mock.patch.object(equipo, 'CONFIG', config), mock.patch.object(equipo, 'tasks', lambda pid, status=None: ts), \
             mock.patch.object(equipo, 'lanzamientos', leer):
            items = {i['id']: i for i in equipo.tablero()}
        self.assertEqual(len(calls), 1)
        self.assertEqual(items['t_0']['lanzado'], '2026-10-15T10:00:00+02:00')
        self.assertNotIn('lanzado', items['t_1'])

    def recordatorios(self):
        base = {'avisado': '2026-10-10T08:00:00+02:00', 'lanzado': '2026-10-11T08:00:00+02:00'}
        equipo.save(self.state / 'experimentos.json', {
            't_r1': {**base, 'proyecto': 'owner-os', 'recordado': '2026-10-13T08:00:00+02:00'},
            't_r2': {**base, 'proyecto': 'owner-os', 'recordado': '2026-10-13T09:00:00+02:00'},
            't_r3': {**base, 'proyecto': 'alfa', 'recordado': '2026-10-13T09:00:00+02:00'},
            't_r4': {**base, 'proyecto': 'owner-os', 'recordado': 'roto'}})
        equipo.save(self.state / 'experimentos' / 'owner-os.json', [
            {'texto': 'Convirtió el 7 %', 'tarea': 't_r1', 'hora': '2026-10-13T18:00:00+02:00'},
            {'texto': 'Convirtió el 3 %', 'tarea': 't_r2', 'hora': '2026-10-16T17:00:00+02:00'},
            {'texto': 'Convirtió el 1 %', 'tarea': 't_r4', 'hora': 'rota'}])
        equipo.save(self.state / 'experimentos' / 'alfa.json', [{'texto': 'Convirtió el 9 %', 'tarea': 't_r3', 'hora': '2026-10-13T10:00:00+02:00'}])

    def test_recordados_count_results_within_72_hours_of_this_project_only(self):
        self.recordatorios()
        found = equipo.experimentos('owner-os')
        self.assertEqual((found['recordados'], found['medidos_tras_recordar']), (2, 1))
        self.assertEqual(equipo.experimentos('alfa')['recordados'], 1)

    def test_broken_dates_do_not_raise_and_old_reminders_are_ignored(self):
        equipo.save(self.state / 'experimentos.json', {
            't_x': {'proyecto': 'owner-os', 'recordado': 'roto'}, 't_y': {'proyecto': 'owner-os', 'recordado': '2026-10-01T08:00:00+02:00'},
            't_z': {'proyecto': 'owner-os', 'recordado': '2026-10-14T08:00:00+02:00'}})
        equipo.save(self.state / 'experimentos' / 'owner-os.json', [{'texto': 'sin hora válida', 'tarea': 't_z', 'hora': 'rota'}, 'basura'])
        found = equipo.experimentos('owner-os')
        self.assertEqual((found['recordados'], found['medidos_tras_recordar']), (1, 0))

    def test_planner_signals_line_for_reminders_only_when_there_are_some(self):
        self.assertNotIn('Recordatorios de medir', equipo.planner_signals('owner-os'))
        self.recordatorios()
        self.assertIn('Recordatorios de medir (7 días): 2 enviados, 1 con resultado en 72 h. Con menos de 5 no es señal.', equipo.planner_signals('owner-os'))

    def test_planner_signals_reminder_line_gives_a_signal_with_five_or_more(self):
        found = {'avisados': 0, 'lanzados': 0, 'sin_medir': [], 'recordados': 6, 'medidos_tras_recordar': 2}
        with mock.patch.object(equipo, 'experimentos', lambda pid: found), mock.patch.object(equipo, 'lessons', lambda pid: []):
            self.assertIn('otra forma de pedir el resultado', equipo.planner_signals('owner-os'))
            found['medidos_tras_recordar'] = 4
            signals = equipo.planner_signals('owner-os')
            self.assertIn('El recordatorio funciona', signals)
            self.assertIn('(67 %)', signals)

    def test_launched_experiment_leaves_sin_medir_once_its_result_is_saved(self):
        self.registro()
        self.assertEqual(equipo.medidos('owner-os'), set())
        self.assertEqual([x['tarea'] for x in equipo.experimentos('owner-os')['sin_medir']], ['t_a'])
        equipo.save(self.state / 'experimentos' / 'owner-os.json', [{'fecha': '2026-10-15', 'texto': 'Convirtió el 7 %', 'tarea': 't_a'}, {'texto': 'sin tarea'}])
        self.assertEqual(equipo.medidos('owner-os'), {'t_a'})
        self.assertEqual(equipo.experimentos('owner-os')['sin_medir'], [])

    def test_sin_medir_is_oldest_first_and_capped_at_five(self):
        equipo.save(self.state / 'experimentos.json', {
            f't_{n}': {'proyecto': 'owner-os', 'titulo': f'Exp {n}', 'avisado': '2026-10-13T08:00:00+02:00', 'lanzado': f'2026-10-14T0{9 - n}:00:00+02:00'}
            for n in range(7)})
        self.assertEqual([x['tarea'] for x in equipo.experimentos('owner-os')['sin_medir']], ['t_6', 't_5', 't_4', 't_3', 't_2'])

    def test_planner_signals_line_without_launches_and_with_unmeasured_ones(self):
        equipo.save(self.state / 'experimentos.json', {'t_b': {'proyecto': 'owner-os', 'avisado': '2026-10-15T09:00:00+02:00'}})
        signals = equipo.planner_signals('owner-os')
        self.assertIn('1 avisados, ninguno lanzado todavía.', signals)
        self.assertNotIn('mediana None', signals)
        self.assertNotIn('Lanzados sin resultado apuntado', signals)
        equipo.save(self.state / 'experimentos.json', {
            't_a': {'proyecto': 'owner-os', 'titulo': 'Landing A', 'avisado': '2026-10-14T08:00:00+02:00', 'lanzado': '2026-10-14T11:00:00+02:00'},
            't_e': {'proyecto': 'owner-os', 'titulo': 'Landing B', 'avisado': '2026-10-14T08:00:00+02:00', 'lanzado': '2026-10-14T12:00:00+02:00'}})
        signals = equipo.planner_signals('owner-os')
        self.assertIn('Lanzados sin resultado apuntado: «Landing A», «Landing B». Pide a Owner lo medido antes de proponer el siguiente experimento de esa línea.', signals)
        equipo.save(self.state / 'experimentos' / 'owner-os.json', [{'texto': 'Convirtió el 7 %', 'tarea': 't_a'}, {'texto': 'Convirtió el 3 %', 'tarea': 't_e'}])
        self.assertNotIn('Lanzados sin resultado apuntado', equipo.planner_signals('owner-os'))

    def test_status_and_brief_include_sin_medir(self):
        self.registro()
        config = {**equipo.CONFIG, 'projects': {'owner-os': equipo.CONFIG['projects']['owner-os']}}
        patches = [mock.patch.object(equipo, 'CONFIG', config), mock.patch.object(equipo, 'tasks', lambda pid, status=None: []),
                   mock.patch.object(equipo, 'project', lambda pid: {'name': 'Owner OS', 'goal': 'g'}), mock.patch.object(equipo, 'lessons', lambda pid: []),
                   mock.patch.object(equipo, 'ficha', lambda pid: None), mock.patch.object(equipo, 'hermes_overview', lambda: {}),
                   mock.patch.object(equipo, 'modelos_hoy', lambda: {}), mock.patch.object(equipo, 'tablero', lambda: []),
                   mock.patch.object(equipo, 'pending_merge', lambda pid: 0), mock.patch.object(equipo, 'checklist', lambda ts: [])]
        for patch in patches: patch.start(); self.addCleanup(patch.stop)
        from_status = equipo.status()['proyectos']['owner-os']['lanzamientos_7d']
        from_brief = equipo.project_brief('owner-os')['lanzamientos_7d']
        for found in (from_status, from_brief):
            self.assertEqual(found['sin_medir'], [{'tarea': 't_a', 'titulo': 't_a'}])
            self.assertEqual((found['avisados'], found['lanzados']), (2, 1))
            self.assertEqual((found['recordados'], found['medidos_tras_recordar']), (0, 0))

    def test_planner_signals_line_only_when_there_are_notices(self):
        self.assertNotIn('Experimentos listos para lanzar', equipo.planner_signals('owner-os'))
        self.registro()
        self.assertIn('Experimentos listos para lanzar (7 días): 2 avisados, 1 lanzados por Owner, mediana 3.0 h hasta lanzar.', equipo.planner_signals('owner-os'))
        self.assertNotIn('Experimentos listos para lanzar', equipo.planner_signals('otro'))

class RecordarMedir(unittest.TestCase):
    """48 h after launching an experiment with no result, Owner is asked once what he measured."""
    ahora = datetime.fromisoformat('2026-10-15T12:00:00+02:00')
    ficha = {'que': 'Landing A/B', 'a_quien': 'Tráfico frío', 'metrica': 'Registros', 'umbral': '5 % de conversión'}

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)
        self.posted, self.sent, self.buttons = [], [], []
        self.ts = [{'id': 't_vieja', 'title': 'Landing nueva', 'body': json.dumps({'lanzamiento': self.ficha})},
                   {'id': 't_sin_ficha', 'title': 'Sin ficha', 'body': None}]
        patches = [mock.patch.object(equipo, 'STATE', self.state), mock.patch.object(equipo, 'now', lambda: self.ahora),
                   mock.patch.object(equipo, 'tasks', lambda pid, status=None: self.ts),
                   mock.patch.object(equipo, 'post', lambda *a, **k: self.posted.append(a)), mock.patch.object(equipo, 'telegram', lambda t, botones=None: (self.sent.append(t), self.buttons.append(botones))),
                   mock.patch.object(equipo, 'log')]
        for patch in patches: patch.start(); self.addCleanup(patch.stop)

    def registro(self, **extra):
        equipo.save(self.state / 'experimentos.json', {
            't_vieja': {'proyecto': 'owner-os', 'titulo': 'Landing nueva', 'avisado': '2026-10-13T08:00:00+02:00', 'lanzado': '2026-10-13T10:00:00+02:00'},
            't_reciente': {'proyecto': 'owner-os', 'titulo': 'Reciente', 'avisado': '2026-10-15T00:00:00+02:00', 'lanzado': '2026-10-15T02:00:00+02:00'},
            't_medida': {'proyecto': 'owner-os', 'titulo': 'Medida', 'avisado': '2026-10-12T08:00:00+02:00', 'lanzado': '2026-10-12T10:00:00+02:00'},
            't_hecha': {'proyecto': 'owner-os', 'titulo': 'Hecha', 'avisado': '2026-10-12T08:00:00+02:00', 'lanzado': '2026-10-12T10:00:00+02:00',
                        'recordado': '2026-10-14T10:00:00+02:00'},
            't_sin_lanzar': {'proyecto': 'owner-os', 'titulo': 'Sin lanzar', 'avisado': '2026-10-10T08:00:00+02:00'}, **extra})
        equipo.save(self.state / 'experimentos' / 'owner-os.json', [{'texto': 'Convirtió el 7 %', 'tarea': 't_medida'}])

    def test_reminds_only_the_old_unmeasured_unreminded_launch_and_once(self):
        self.registro()
        self.assertEqual(equipo.recordar_medir(), ['t_vieja'])
        texto = '¿Qué has medido en «Landing nueva»? Métrica: Registros; umbral: 5 % de conversión. Cuéntaselo a Alfred y lo apunta.'
        self.assertEqual(self.sent, [texto])
        self.assertEqual(self.posted, [('alfred', ['owner'], texto, 'aviso', 'owner-os')])
        self.assertEqual(equipo.lanzamientos()['t_vieja']['recordado'], '2026-10-15T12:00:00+02:00')
        self.assertNotIn('recordado', equipo.lanzamientos()['t_reciente'])
        self.assertEqual(equipo.recordar_medir(), [])
        self.assertEqual((len(self.sent), len(self.posted)), (1, 1))

    def test_reminder_carries_the_measure_button(self):
        self.registro()
        self.assertEqual(equipo.recordar_medir(), ['t_vieja'])
        self.assertEqual(self.buttons, [[[{'text': 'Apuntar lo medido', 'callback_data': 'm:t_vieja'}]]])

    def test_task_id_too_long_for_a_button_is_reminded_without_it(self):
        largo = 'a' * 80          # 'm:' + 80 characters is over the 64 bytes Telegram allows
        self.registro(**{largo: {'proyecto': 'owner-os', 'titulo': 'Larga', 'lanzado': '2026-10-10T10:00:00+02:00'}})
        self.assertIn(largo, equipo.recordar_medir())
        self.assertIn('¿Qué has medido en «Larga»? Cuéntaselo a Alfred y lo apunta.', self.sent)
        self.assertEqual(self.buttons[self.sent.index('¿Qué has medido en «Larga»? Cuéntaselo a Alfred y lo apunta.')], None)

    def test_without_card_the_metric_and_threshold_are_left_out(self):
        self.registro(t_sin_ficha={'proyecto': 'owner-os', 'titulo': 'Sin ficha', 'lanzado': '2026-10-10T10:00:00+02:00'})
        self.assertIn('t_sin_ficha', equipo.recordar_medir())
        self.assertIn('¿Qué has medido en «Sin ficha»? Cuéntaselo a Alfred y lo apunta.', self.sent)

    def test_telegram_failure_still_marks_it_and_one_failing_entry_does_not_stop_the_rest(self):
        self.registro(t_rota={'proyecto': 'owner-os', 'lanzado': 'no es una fecha'})
        def broken(text, botones=None): raise RuntimeError('Telegram caído')
        with mock.patch.object(equipo, 'telegram', broken):
            self.assertEqual(equipo.recordar_medir(), ['t_vieja'])
        self.assertEqual(len(self.posted), 1)
        self.assertTrue(equipo.lanzamientos()['t_vieja']['recordado'])
        self.assertNotIn('recordado', equipo.lanzamientos()['t_rota'])
        self.assertEqual(equipo.recordar_medir(), [])

    def test_without_record_reminds_nothing(self):
        self.assertEqual(equipo.recordar_medir(), [])
        self.assertEqual((self.sent, self.posted), ([], []))

    def test_run_all_reminds_even_when_the_team_is_paused(self):
        root = Path(self.tmp.name) / 'root'; root.mkdir(); (root / 'PAUSED').touch()
        with mock.patch.object(equipo, 'ROOT', root), mock.patch.object(equipo, 'salud') as salud, \
             mock.patch.object(equipo, 'recordar_medir') as recordar, mock.patch.object(equipo, 'answer_owner') as answer, \
             mock.patch.object(equipo, 'recordar_lanzar') as lanzar:
            equipo.run_all()
            salud.assert_called_once(); recordar.assert_called_once(); answer.assert_not_called()
            lanzar.assert_called_once()
        with mock.patch.object(equipo, 'ROOT', root), mock.patch.object(equipo, 'salud'), \
             mock.patch.object(equipo, 'recordar_medir', side_effect=RuntimeError('fallo')), \
             mock.patch.object(equipo, 'recordar_lanzar', side_effect=RuntimeError('fallo')) as lanzar:
            equipo.run_all()   # a failing reminder never stops run_all
            lanzar.assert_called_once()

class RecordarLanzar(unittest.TestCase):
    """An experiment ready for 48 h to 7 days reaches Owner once, during daytime only."""
    ahora = datetime.fromisoformat('2026-10-15T12:00:00+02:00')
    ficha = {'que': 'Landing A/B', 'a_quien': 'Tráfico frío', 'metrica': 'Registros', 'umbral': '5 % de conversión'}

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)
        self.posted, self.sent, self.buttons = [], [], []
        self.ts = [{'id': 't_vieja', 'title': 'Landing nueva', 'body': json.dumps({'lanzamiento': self.ficha})}]
        self.read_tasks = mock.Mock(side_effect=lambda pid: self.ts)
        patches = [mock.patch.object(equipo, 'STATE', self.state), mock.patch.object(equipo, 'now', lambda: self.ahora),
                   mock.patch.object(equipo, 'tasks', self.read_tasks),
                   mock.patch.object(equipo, 'post', lambda *a, **k: self.posted.append(a)),
                   mock.patch.object(equipo, 'telegram', lambda t, botones=None: (self.sent.append(t), self.buttons.append(botones))),
                   mock.patch.object(equipo, 'log')]
        for patch in patches: patch.start(); self.addCleanup(patch.stop)

    def registro(self, **extra):
        equipo.save(self.state / 'experimentos.json', {
            't_vieja': {'proyecto': 'owner-os', 'titulo': 'Landing nueva', 'avisado': '2026-10-13T10:00:00+02:00'}, **extra})

    def test_reminds_only_the_old_pending_launch_and_once(self):
        self.registro()
        self.assertEqual(equipo.recordar_lanzar(), ['t_vieja'])
        texto = (f"⏳ «Landing nueva» lleva 2 días listo para lanzar en {equipo.project('owner-os')['name']}.\n"
                 'Qué: Landing A/B\nA quién: Tráfico frío\nMétrica: Registros\nUmbral: 5 % de conversión\n'
                 '¿Lo lanzas o te frena algo?')
        self.assertEqual(self.sent, [texto])
        self.assertEqual(self.posted, [('alfred', ['owner'], texto, 'aviso', 'owner-os')])
        self.assertEqual(equipo.lanzamientos()['t_vieja']['recordado_lanzar'], self.ahora.isoformat(timespec='seconds'))
        self.assertEqual(equipo.recordar_lanzar(), [])
        self.assertEqual((len(self.sent), len(self.posted)), (1, 1))

    def test_skips_launched_discarded_recent_expired_missing_cards_and_unknown_projects(self):
        base = {'proyecto': 'owner-os', 'avisado': '2026-10-13T10:00:00+02:00'}
        entries = {'t_lanzada': {**base, 'lanzado': '2026-10-14T10:00:00+02:00'},
                   't_descartada': {**base, 'descartado': '2026-10-14T10:00:00+02:00'},
                   't_reciente': {**base, 'avisado': '2026-10-13T12:00:01+02:00'},
                   't_caducada': {**base, 'avisado': '2026-10-08T11:59:59+02:00'},
                   't_sin_ficha': base, 't_no_existe': base,
                   't_desconocida': {**base, 'proyecto': 'desconocido'}, 't_basura': 'roto'}
        for tid in entries:
            if tid != 't_no_existe': self.ts.append({**self.ts[0], 'id': tid})
        next(t for t in self.ts if t['id'] == 't_sin_ficha')['body'] = None
        self.registro(**entries)
        self.assertEqual(equipo.recordar_lanzar(), ['t_vieja'])
        for tid in entries:
            if isinstance(entries[tid], dict): self.assertNotIn('recordado_lanzar', equipo.lanzamientos()[tid])

    def test_reads_registry_once_and_tasks_once_per_project_at_inclusive_age_limits(self):
        self.registro(t_limite={'proyecto': 'owner-os', 'avisado': '2026-10-13T12:00:00+02:00'},
                      t_semana={'proyecto': 'owner-os', 'avisado': '2026-10-08T12:00:00+02:00'})
        for tid in ('t_limite', 't_semana'): self.ts.append({**self.ts[0], 'id': tid})
        with mock.patch.object(equipo, 'lanzamientos', wraps=equipo.lanzamientos) as leer:
            self.assertEqual(equipo.recordar_lanzar(), ['t_vieja', 't_limite', 't_semana'])
            leer.assert_called_once_with()
        self.read_tasks.assert_called_once_with('owner-os')
        self.assertIn('lleva 7 días', self.sent[-1])

    def test_reminder_carries_exact_launch_and_discard_buttons(self):
        self.registro()
        equipo.recordar_lanzar()
        self.assertEqual(self.buttons, [[[{'text': 'Ya lo he lanzado', 'callback_data': 'l:t_vieja'},
                                         {'text': 'No lo lanzo', 'callback_data': 'n:t_vieja'}]]])

    def test_long_or_invalid_task_id_is_reminded_without_buttons(self):
        for tid in ('a' * 80, 'id inválido'):
            with self.subTest(tid=tid):
                self.ts.append({**self.ts[0], 'id': tid})
                self.registro(**{tid: {'proyecto': 'owner-os', 'avisado': '2026-10-13T10:00:00+02:00'}})
                self.assertIn(tid, equipo.recordar_lanzar())
                self.assertIsNone(self.buttons[-1])

    def test_broken_date_and_telegram_failure_do_not_stop_the_rest_or_repeat(self):
        base = {'proyecto': 'owner-os', 'avisado': '2026-10-13T10:00:00+02:00'}
        equipo.save(self.state / 'experimentos.json', {'t_rota': {**base, 'avisado': 'roto'}, 't_vieja': base, 't_otra': base})
        self.ts.append({**self.ts[0], 'id': 't_otra'})
        def broken(text, botones=None):
            self.assertTrue(equipo.lanzamientos()['t_vieja'].get('recordado_lanzar'))
            raise RuntimeError('Telegram caído')
        with mock.patch.object(equipo, 'telegram', side_effect=broken) as enviar:
            self.assertEqual(equipo.recordar_lanzar(), ['t_vieja', 't_otra'])
            self.assertEqual(enviar.call_count, 2)
        self.assertEqual(len(self.posted), 2)
        self.assertNotIn('recordado_lanzar', equipo.lanzamientos()['t_rota'])
        self.assertTrue(equipo.lanzamientos()['t_otra']['recordado_lanzar'])
        self.assertEqual(equipo.log.call_count, 3)
        self.assertEqual(equipo.recordar_lanzar(), [])

    def test_outside_window_does_not_read_or_send(self):
        self.registro()
        for hour in (8, 22):
            with self.subTest(hour=hour), mock.patch.object(equipo, 'lanzamientos') as leer:
                self.assertEqual(equipo.recordar_lanzar(at=self.ahora.replace(hour=hour)), [])
                leer.assert_not_called()
        self.read_tasks.assert_not_called()
        self.assertEqual((self.sent, self.posted), ([], []))

class LimitesCompartidos(unittest.TestCase):
    """The engine, the local server and the app must agree on the result limits and on the task id rule."""
    repo = Path(__file__).resolve().parent.parent

    def test_result_limits_match_office_limits(self):
        text = (self.repo / 'alfred-os' / 'lib' / 'office-limits.ts').read_text()
        for name in ('RESULTADO_MIN', 'RESULTADO_MAX'):
            found = re.search(rf'export const {name}\s*=\s*(\d+)', text)
            self.assertIsNotNone(found, name)
            self.assertEqual(int(found.group(1)), getattr(equipo, name), name)

    def test_decisions_match_office_limits(self):
        text = (self.repo / 'alfred-os' / 'lib' / 'office-limits.ts').read_text()
        found = re.search(r'export const DECISIONES\s*=\s*\[([^\]]*)\]', text)
        self.assertIsNotNone(found, 'no encuentro la constante DECISIONES en office-limits.ts')
        self.assertEqual(re.findall(r"'([^']*)'", found.group(1)), list(equipo.DECISIONES))

    def test_pending_merge_phase_matches_office_limits(self):
        text = (self.repo / 'alfred-os' / 'lib' / 'office-limits.ts').read_text()
        found = re.search(r"export const FASE_FALTA_FUSIONAR\s*=\s*'([^']*)'", text)
        self.assertIsNotNone(found, 'no encuentro la constante FASE_FALTA_FUSIONAR en office-limits.ts')
        self.assertEqual(found.group(1), equipo.FASE_FALTA_FUSIONAR)

    def test_task_id_rule_matches_equipo_acciones(self):
        text = (self.repo / 'mac' / 'local-workspace' / 'equipo-acciones.ts').read_text()
        self.assertIn("'decidir'", text)
        for decision in equipo.DECISIONES:
            args = equipo.parser().parse_args(['decidir', 't_036cee09', '--decision', decision])
            self.assertEqual((args.cmd, args.project, args.decision), ('decidir', 't_036cee09', decision))
        found = re.search(r'const TAREA=/(.+)/;', text)
        self.assertIsNotNone(found)
        self.assertEqual(found.group(1), equipo.TAREA_ID.pattern)

    def test_launch_button_prefix_matches_equipo_acciones(self):
        archivo = 'mac/local-workspace/equipo-acciones.ts'
        found = re.search(r"export const BOTON_LANZADO\s*=\s*'([^']*)'", (self.repo / archivo).read_text())
        self.assertIsNotNone(found, f'no encuentro la constante BOTON_LANZADO en {archivo}')
        self.assertEqual(found.group(1), equipo.BOTON_LANZADO)

    def test_measure_button_prefix_matches_equipo_acciones(self):
        archivo = 'mac/local-workspace/equipo-acciones.ts'
        found = re.search(r"export const BOTON_MEDIDO\s*=\s*'([^']*)'", (self.repo / archivo).read_text())
        self.assertIsNotNone(found, f'no encuentro la constante BOTON_MEDIDO en {archivo}')
        self.assertEqual(found.group(1), equipo.BOTON_MEDIDO)

    def test_no_launch_button_prefix_matches_equipo_acciones(self):
        archivo = 'mac/local-workspace/equipo-acciones.ts'
        found = re.search(r"export const BOTON_NO_LANZO\s*=\s*'([^']*)'", (self.repo / archivo).read_text())
        self.assertIsNotNone(found, f'no encuentro la constante BOTON_NO_LANZO en {archivo}')
        self.assertEqual(found.group(1), equipo.BOTON_NO_LANZO)

    def test_merge_button_matches_equipo_acciones(self):
        archivo = 'mac/local-workspace/equipo-acciones.ts'
        text = (self.repo / archivo).read_text()
        boton = re.search(r"export const BOTON_FUSIONAR\s*=\s*'([^']*)'", text)
        project = re.search(r'export const PROJECT=/(.+)/;', text)
        self.assertIsNotNone(boton, f'no encuentro la constante BOTON_FUSIONAR en {archivo}')
        self.assertIsNotNone(project, f'no encuentro la constante PROJECT en {archivo}')
        self.assertEqual(boton.group(1), equipo.BOTON_FUSIONAR)
        self.assertEqual(project.group(1), equipo.PROYECTO_ID.pattern)
        for pid in ('owner-os', 'alfa', 'beta'):
            callback = equipo.BOTON_FUSIONAR + pid
            self.assertLessEqual(len(callback.encode()), 64)
            self.assertTrue(equipo.PROYECTO_ID.fullmatch(pid), pid)

    def test_task_id_edge_cases(self):
        for tid in ('abc', 'a' * 80): self.assertTrue(equipo.TAREA_ID.fullmatch(tid), tid)
        for tid in ('ab', 'a' * 81, '-abc', 'a b c'): self.assertFalse(equipo.TAREA_ID.fullmatch(tid), tid)

    def test_result_length_edges(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(equipo, 'STATE', Path(tmp)):
            with self.assertRaises(equipo.Stop): equipo.registrar_resultado('owner-os', 'x' * (equipo.RESULTADO_MIN - 1))
            self.assertFalse((Path(tmp) / 'experimentos').exists())
            self.assertEqual(len(equipo.registrar_resultado('owner-os', 'x' * equipo.RESULTADO_MIN)['texto']), equipo.RESULTADO_MIN)
            self.assertEqual(len(equipo.registrar_resultado('owner-os', 'x' * 700)['texto']), equipo.RESULTADO_MAX)
            self.assertEqual([len(r['texto']) for r in equipo.resultados('owner-os')], [equipo.RESULTADO_MIN, equipo.RESULTADO_MAX])

if __name__ == '__main__':
    unittest.main()


class ContinuousRounds(unittest.TestCase):
    """A finished batch (every card done or blocked) leads to the next round the same day, within the daily cap."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name) / 'state'; self.root = Path(self.tmp.name)
        self.status = {'t1': 'done', 't2': 'blocked'}
        self.notes, self.approved = [], []
        cfg = {**equipo.CONFIG, 'continuo': True, 'projects': {**equipo.CONFIG['projects']}}
        cfg['projects']['alfa'] = {**cfg['projects']['alfa'], 'continuo': True, 'auto_aprobar': False}
        for target, value in (('STATE', self.state), ('ROOT', self.root), ('CONFIG', cfg),
                              ('LIMITS', {**equipo.LIMITS, 'rounds_per_day': 3}),
                              ('tasks', lambda pid, status=None: [{'id': k, 'status': v, 'title': k} for k, v in self.status.items()]),
                              ('notify', lambda title, text: self.notes.append(title)),
                              ('approve', lambda pids, *a: self.approved.append(pids))):
            p = mock.patch.object(equipo, target, value); p.start(); self.addCleanup(p.stop)

    def batch(self, **entry):
        equipo.save(self.state / 'proposals' / f'{equipo.today()}.json',
                    {'fecha': equipo.today(), 'proyectos': {'alfa': {'estado': 'aprobado', 'tarjetas': {'0': 't1', '1': 't2'}, **entry}}})

    def planned(self, estado='pendiente'):
        calls = []
        def fake(pid, batch, file, ronda=1, waiting=()):
            calls.append(ronda); entry = {'estado': estado, 'tareas': [{'titulo': 'Siguiente paso', 'depende_de': []}], 'ronda': ronda}
            batch['proyectos'][pid] = entry; equipo.save(file, batch); return entry
        return calls, mock.patch.object(equipo, 'plan_project', fake)

    def test_unfinished_round_waits(self):
        self.status['t2'] = 'running'; self.batch()
        calls, patch = self.planned()
        with patch: self.assertIsNone(equipo.next_round('alfa'))
        self.assertEqual(calls, [])

    def test_finished_round_plans_the_next_and_asks_owner(self):
        self.batch()
        calls, patch = self.planned()
        with patch: self.assertEqual(equipo.next_round('alfa'), 'pendiente')
        self.assertEqual(calls, [2]); self.assertEqual(self.approved, []); self.assertIn('ronda 2', self.notes[0])

    def test_waiting_important_task_clears_empty_plan_reason(self):
        self.batch(estado='pendiente', tareas=[{'titulo': 'Importante', 'depende_de': [], 'importante': 'Decide Owner'}])
        def fake(pid, batch, file, ronda=1, waiting=()):
            entry = {'estado': 'sin propuestas', 'motivo': 'todo lo propuesto ya estaba en el tablero o repetido (2)',
                     'tareas': [], 'ronda': ronda}
            batch['proyectos'][pid] = entry; equipo.save(file, batch); return entry
        with mock.patch.object(equipo, 'plan_project', fake):
            self.assertEqual(equipo.next_round('alfa'), 'pendiente')
        entry = equipo.load(self.state / 'proposals' / f'{equipo.today()}.json', None)['proyectos']['alfa']
        self.assertEqual(entry['estado'], 'pendiente')
        self.assertNotIn('motivo', entry)
        self.assertEqual(entry['tareas'][0]['titulo'], 'Importante')
        self.assertIn('importante', entry['tareas'][0])

    def test_auto_approval_starts_it(self):
        equipo.CONFIG['projects']['alfa']['auto_aprobar'] = True; self.batch(ronda=2)
        calls, patch = self.planned()
        held = []
        with patch, mock.patch.object(equipo, '_approve', lambda pids, hold=None, by='': held.append((pids, hold, by))):
            self.assertEqual(equipo.next_round('alfa'), 'aprobada')
        self.assertEqual((calls, held), ([3], [(['alfa'], set(), 'equipo')]))

    def test_failed_plan_is_retried_once_on_its_own(self):
        self.batch(estado='error', motivo='titulo', ronda=3)
        calls, patch = self.planned('error')
        with patch:
            self.assertEqual(equipo.next_round('alfa'), 'error')
            self.assertIsNone(equipo.next_round('alfa'))                        # no retry loop
        self.assertEqual(calls, [3])

    def test_relaunch_keeps_the_round_and_asks_owner(self):
        self.batch(estado='error', motivo='titulo', ronda=2)
        calls, patch = self.planned()
        with patch: self.assertEqual(equipo.retry_round('alfa'), 'pendiente')
        self.assertEqual(calls, [2]); self.assertIn('ronda 2', self.notes[0])
        with patch: self.assertIsNone(equipo.retry_round('alfa'))               # nothing failed any more

    def test_daily_cap_and_off_switches(self):
        self.batch(ronda=3)
        calls, patch = self.planned()
        with patch:
            self.assertIsNone(equipo.next_round('alfa')); self.assertIsNone(equipo.next_round('alfa'))
        self.assertEqual(calls, []); self.assertEqual(len(self.notes), 1)          # cap notice sent once
        self.batch()
        (self.root / 'PAUSED').write_text('x')
        with patch: self.assertIsNone(equipo.next_round('alfa'))
        (self.root / 'PAUSED').unlink(); equipo.CONFIG['projects']['alfa']['continuo'] = False
        with patch: self.assertIsNone(equipo.next_round('alfa'))
        self.assertEqual(calls, [])

    def test_parallel_planners_do_not_overwrite_each_other(self):
        """Regression: two projects planning in separate processes each saved a stale copy and one round vanished."""
        file = self.state / 'proposals' / f'{equipo.today()}.json'
        equipo.save(file, {'fecha': equipo.today(), 'proyectos': {}})
        stale_a, stale_b = equipo.load(file, None), equipo.load(file, None)     # both read before either writes
        with mock.patch.object(equipo, 'git', lambda *a, **k: 'abc'), mock.patch.object(equipo, 'worktree', lambda *a, **k: self.root), \
             mock.patch.object(equipo, 'context_text', lambda *a: ''), mock.patch.object(equipo, 'planner_signals', lambda pid: ''), \
             mock.patch.object(equipo, 'claude', lambda *a, **k: '```json\n[]\n```'):
            equipo.plan_project('alfa', stale_a, file, 2)
            equipo.plan_project('beta', stale_b, file, 2)
        self.assertEqual(set(equipo.load(file, None)['proyectos']), {'alfa', 'beta'})


class ImportantTasks(unittest.TestCase):
    """Routine work runs on its own; Owner only decides what is marked important (or touches sensitive files)."""
    base = {'titulo': 'Una tarea', 'porque': 'x', 'detalle': 'Criterios de aceptación concretos', 'pruebas': ['unitarias'], 'depende_de': []}

    def test_launch_details_are_optional_and_normalized(self):
        ficha = {'que': 'Experimento', 'a_quien': 'Clientes', 'metrica': 'Respuestas', 'umbral': 'Seguir con 5 respuestas'}
        v = lambda **k: equipo.validate_task('alfa', {**self.base, 'archivos': ['lib/engine.js'], **k}, 0)
        complete = {k: f'  {value}  ' for k, value in ficha.items()}
        out = v(lanzamiento={**complete, 'extra': 'Se descarta'})
        self.assertEqual(out['lanzamiento'], ficha)
        self.assertNotIn('importante', out)
        self.assertNotIn('lanzamiento', v())
        for key in ficha:
            for bad in ({k: value for k, value in ficha.items() if k != key},
                        {**ficha, key: ' \t\n'}, {**ficha, key: 123}):
                with self.subTest(key=key, lanzamiento=bad):
                    out = v(lanzamiento=bad)
                    self.assertNotIn('lanzamiento', out)
                    self.assertEqual(out['titulo'], self.base['titulo'])
            with self.subTest(long_value=key):
                self.assertEqual(v(lanzamiento={**ficha, key: '  ' + 'x' * 300 + '  '})['lanzamiento'][key], 'x' * 200)
        out = v(lanzamiento='Experimento')
        self.assertNotIn('lanzamiento', out)
        self.assertEqual(out['titulo'], self.base['titulo'])

    def test_plan_project_preserves_launch_details_in_proposals(self):
        ficha = {'que': 'Experimento', 'a_quien': 'Clientes', 'metrica': 'Respuestas', 'umbral': 'Seguir con 5 respuestas'}
        tarea = {**self.base, 'archivos': ['lib/engine.js'], 'lanzamiento': ficha}
        p = {**equipo.project('alfa'), 'related_boards': []}
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp); file = state / 'proposals' / f'{equipo.today()}.json'
            batch = {'fecha': equipo.today(), 'proyectos': {}}
            with mock.patch.object(equipo, 'STATE', state), mock.patch.object(equipo, 'project', return_value=p), \
                 mock.patch.object(equipo, 'git', lambda *a, **k: 'abc'), mock.patch.object(equipo, 'worktree', lambda *a, **k: state), \
                 mock.patch.object(equipo, 'tasks', return_value=[]), mock.patch.object(equipo, 'log'), \
                 mock.patch.object(equipo, 'context_text', lambda *a: ''), mock.patch.object(equipo, 'planner_signals', lambda pid: ''), \
                 mock.patch.object(equipo, 'claude', return_value='```json\n' + json.dumps([tarea]) + '\n```'):
                equipo.plan_project('alfa', batch, file)
            entry = equipo.load(file, None)['proyectos']['alfa']
            self.assertEqual(entry['estado'], 'pendiente')
            self.assertEqual(len(entry['tareas']), 1)
            self.assertEqual(entry['tareas'][0]['lanzamiento'], ficha)

    def test_sensitive_files_always_wait_and_tests_never_do(self):
        v = lambda files, **k: equipo.validate_task('alfa', {**self.base, 'archivos': files, **k}, 0)
        self.assertNotIn('importante', v(['lib/engine.js', 'test/auth.test.js']))
        self.assertIn('package.json', v(['package.json'])['importante'])
        self.assertIn('auth', v(['lib/auth.js'])['importante'])
        self.assertIn('importante', v(['lib/engine.js'], importante=True, motivo_importante='Cambia el precio'))
        self.assertNotIn('importante', v(['lib/engine.js'], importante='sí'))       # only a real true counts

    def test_held_positions_follow_dependencies(self):
        t = lambda imp=False, deps=(): {'importante': 'x' if imp else None, 'depende_de': list(deps)}
        self.assertEqual(equipo.held_positions([t(), t(True), t(deps=[1]), t(deps=[0])]), {1, 2})

    def test_batch_records_owner_decisions_from_creation(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp); start = equipo.now().replace(microsecond=0); date = start.date().isoformat()
            tareas = [{**self.base, 'titulo': 'Con ficha', 'lanzamiento': {'que': 'x'}},
                      {**self.base, 'titulo': 'Sin ficha'}]
            equipo.save(state / 'proposals' / f'{date}.json', {'fecha': date, 'proyectos': {'alfa': {
                'estado': 'pendiente', 'creado': (start - timedelta(minutes=25)).isoformat(), 'tareas': tareas}}})
            @__import__('contextlib').contextmanager
            def fake_board(pid): yield None
            with mock.patch.object(equipo, 'STATE', state), mock.patch.object(equipo, 'now', return_value=start), \
                 mock.patch.object(equipo, 'board', fake_board), mock.patch.object(equipo.kb, 'create_task', return_value='t1'), \
                 mock.patch.object(equipo, 'log'):
                equipo._approve(['alfa'], only=[0])
                decisions = equipo.load(state / 'senales' / 'alfa.json', {})['decisiones']
                self.assertEqual(decisions, [
                    {'fecha': date, 'titulo': 'Con ficha', 'decision': 'aprobada', 'minutos': 25.0, 'ficha': True},
                    {'fecha': date, 'titulo': 'Sin ficha', 'decision': 'descartada', 'minutos': 25.0, 'ficha': False}])
                m = equipo.metrics('alfa')
                self.assertEqual(m['decisiones_tuyas'], 2)
                self.assertEqual(m['decisiones_con_ficha'], 1)

    def test_batch_auto_approval_and_missing_dates_record_no_decisions(self):
        for by in ('equipo', 'Owner'):
            with self.subTest(by=by), tempfile.TemporaryDirectory() as tmp:
                state = Path(tmp); start = equipo.now().replace(microsecond=0); date = start.date().isoformat()
                entry = {'estado': 'pendiente', 'tareas': [dict(self.base)]}
                if by == 'equipo': entry['creado'] = (start - timedelta(minutes=25)).isoformat()
                equipo.save(state / 'proposals' / f'{date}.json', {'fecha': date, 'proyectos': {'alfa': entry}})
                @__import__('contextlib').contextmanager
                def fake_board(pid): yield None
                with mock.patch.object(equipo, 'STATE', state), mock.patch.object(equipo, 'now', return_value=start), \
                     mock.patch.object(equipo, 'board', fake_board), mock.patch.object(equipo.kb, 'create_task', return_value='t1'), \
                     mock.patch.object(equipo, 'log'):
                    equipo._approve(['alfa'], by=by)
                self.assertFalse((state / 'senales' / 'alfa.json').exists())

    def test_batch_decision_dates_fallback_and_never_go_negative(self):
        start = equipo.now().replace(microsecond=0)
        created = (start - timedelta(minutes=25)).isoformat()
        for retained, proposed, expected in (
                ((start - timedelta(seconds=92)).isoformat(), created, 1.5),
                ('invalid', created, 25.0), (123, created, 25.0),
                ((start + timedelta(minutes=5)).isoformat(), created, 0.0),
                ('invalid', 'invalid', None), (123, 123, None)):
            with self.subTest(retained=retained, proposed=proposed), tempfile.TemporaryDirectory() as tmp:
                state = Path(tmp); date = start.date().isoformat()
                entry = {'estado': 'pendiente', 'creado': proposed, 'tareas': [{**self.base, 'retenida': retained}]}
                equipo.save(state / 'proposals' / f'{date}.json', {'fecha': date, 'proyectos': {'alfa': entry}})
                with mock.patch.object(equipo, 'STATE', state), mock.patch.object(equipo, 'now', return_value=start), \
                     mock.patch.object(equipo, 'log'):
                    equipo._approve(['alfa'], only=[])
                decisions = equipo.load(state / 'senales' / 'alfa.json', {}).get('decisiones', [])
                self.assertEqual([d['minutos'] for d in decisions], [] if expected is None else [expected])

    def test_held_tasks_record_owner_decisions_and_preserve_discards(self):
        for only in (None, [0], []):
            with self.subTest(only=only), tempfile.TemporaryDirectory() as tmp:
                state = Path(tmp); date = equipo.today(); file = state / 'proposals' / f'{date}.json'
                tareas = [{**self.base, 'titulo': f'Tarea {i}', 'archivos': ['lib/a.js']} for i in range(3)]
                equipo.save(file, {'fecha': date, 'proyectos': {'alfa': {'estado': 'pendiente', 'tareas': tareas}}})
                made = []
                @__import__('contextlib').contextmanager
                def fake_board(pid): yield None
                def create(conn, title, **k): made.append(title); return f't{len(made)}'
                start = equipo.now().replace(microsecond=0)
                with mock.patch.object(equipo, 'STATE', state), mock.patch.object(equipo, 'board', fake_board), \
                     mock.patch.object(equipo.kb, 'create_task', create), mock.patch.object(equipo, 'now', return_value=start) as clock:
                    equipo._approve(['alfa'], date=date, hold={1}, by='equipo')
                    entry = equipo.load(file, None)['proyectos']['alfa']
                    self.assertEqual(entry['tareas'][0]['retenida'], start.isoformat(timespec='seconds'))
                    self.assertEqual([i for i, t in enumerate(entry['todas']) if 'retenida' in t], [1])
                    self.assertEqual(made, ['Tarea 0', 'Tarea 2'])
                    signals_file = state / 'senales' / 'alfa.json'
                    self.assertFalse(signals_file.exists())
                    clock.return_value = start + equipo.timedelta(minutes=10)
                    equipo._approve(['alfa'], date=date, hold={0}, by='equipo')
                    self.assertEqual(equipo.load(file, None)['proyectos']['alfa']['tareas'][0]['retenida'], start.isoformat(timespec='seconds'))
                    equipo._approve(['alfa'], date=date, only=only)
                    signals = equipo.load(signals_file, None)
                    decision = signals['decisiones'][0]
                    self.assertEqual(decision, {'fecha': date, 'titulo': 'Tarea 1',
                                               'decision': 'descartada' if only == [] else 'aprobada', 'minutos': 10.0, 'ficha': False})
                    self.assertGreaterEqual(decision['minutos'], 0)
                    self.assertEqual([t['titulo'] for t in signals['descartadas']], ['Tarea 1'] if only == [] else [])
                    self.assertEqual(made, ['Tarea 0', 'Tarea 2'] if only == [] else ['Tarea 0', 'Tarea 2', 'Tarea 1'])
                    equipo._approve(['alfa'], date=date, only=only)
                    self.assertEqual(equipo.load(signals_file, None), signals)

    def test_held_task_with_launch_card_records_ficha(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp); date = equipo.today(); file = state / 'proposals' / f'{date}.json'
            tareas = [{**self.base, 'titulo': 'Con ficha', 'archivos': ['lib/a.js'], 'lanzamiento': {'que': 'x'}}]
            equipo.save(file, {'fecha': date, 'proyectos': {'alfa': {'estado': 'pendiente', 'tareas': tareas}}})
            start = equipo.now().replace(microsecond=0)
            @__import__('contextlib').contextmanager
            def fake_board(pid): yield None
            with mock.patch.object(equipo, 'STATE', state), mock.patch.object(equipo, 'board', fake_board), \
                 mock.patch.object(equipo.kb, 'create_task', lambda conn, title, **k: 't1'), mock.patch.object(equipo, 'now', return_value=start):
                equipo._approve(['alfa'], date=date, hold={0}, by='equipo')
                equipo._approve(['alfa'], date=date)
            decision = equipo.load(state / 'senales' / 'alfa.json', None)['decisiones'][0]
            self.assertEqual((decision['titulo'], decision['ficha']), ('Con ficha', True))

    def test_partial_approval_creates_routine_cards_and_keeps_the_rest_pending(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp); file = state / 'proposals' / f'{equipo.today()}.json'
            tareas = [{**self.base, 'titulo': f'Tarea {i}', 'archivos': ['lib/a.js'], **({'importante': 'Toca precios'} if i == 1 else {})} for i in range(3)]
            equipo.save(file, {'fecha': equipo.today(), 'proyectos': {'alfa': {'estado': 'pendiente', 'ronda': 2, 'tareas': tareas}}})
            made = []
            @__import__('contextlib').contextmanager
            def fake_board(pid): yield None
            def create(conn, title, body, **k): made.append((title, json.loads(body)['autorizacion'])); return f't{len(made)}'
            with mock.patch.object(equipo, 'STATE', state), mock.patch.object(equipo, 'board', fake_board), \
                 mock.patch.object(equipo.kb, 'create_task', create), mock.patch.object(equipo, 'remember_discarded', lambda *a: None):
                equipo._approve(['alfa'], hold={1}, by='equipo')
                entry = equipo.load(file, None)['proyectos']['alfa']
                self.assertEqual([m[0] for m in made], ['Tarea 0', 'Tarea 2'])
                self.assertIn('el equipo', made[0][1])
                self.assertEqual((entry['estado'], [t['titulo'] for t in entry['tareas']], entry['indices']), ('pendiente', ['Tarea 1'], [1]))
                equipo._approve(['alfa'])                                            # Owner approves the important one later
                entry = equipo.load(file, None)['proyectos']['alfa']
                self.assertEqual((made[-1], entry['estado'], len(entry['tareas']), entry['tarjetas']),
                                 (('Tarea 1', made[-1][1]), 'aprobado', 3, {'0': 't1', '1': 't3', '2': 't2'}))
                self.assertIn('Owner', made[-1][1])


class FailedStart(unittest.TestCase):
    """A test that fails because the demo server did not start runs once more before it costs an attempt."""
    def run_tests(self, outputs, calls, test=None):
        queue = list(outputs); ticks = [0]
        def run(*a, **k):
            calls.append(k.get('out')); return queue.pop(0)
        def clock():
            ticks[0] += 1; return ticks[0]
        with mock.patch.object(equipo, 'sleep_clock', clock), \
             mock.patch.object(equipo, 'run', run), \
             mock.patch.object(equipo, 'log', lambda *a, **kw: None), \
             mock.patch.object(equipo, 'project', lambda pid: {'tests': {'demo': test or {'cmd': ['node', '--test']}}}):
            return equipo.run_tests('alfa', {'pruebas': ['demo']}, Path('/tmp'), Path('/tmp/x'), None)

    def test_a_failed_start_is_repeated_and_the_repeat_counts(self):
        calls = []
        results = self.run_tests([(1, 'server did not become healthy'), (0, 'ok')], calls)
        self.assertEqual((results[0]['ok'], results[0]['repetida'], len(calls)), (True, True, 2))
        self.assertEqual([c.name for c in calls], ['test-demo-0.log', 'test-demo-0-r.log'])

    def test_two_failed_starts_are_a_normal_failure(self):
        calls = []
        results = self.run_tests([(1, 'did not become healthy'), (1, 'EADDRINUSE')], calls)
        self.assertFalse(results[0]['ok'])
        self.assertIn('fallo', results[0])
        self.assertEqual(len(calls), 2)

    def test_a_normal_failure_is_not_repeated(self):
        calls = []
        results = self.run_tests([(1, 'expected 2')], calls)
        self.assertFalse(results[0]['ok'])
        self.assertNotIn('repetida', results[0])
        self.assertEqual(len(calls), 1)

    def test_only_the_failed_step_decides_the_repeat(self):
        calls = []
        results = self.run_tests([(0, 'did not become healthy'), (1, 'expected 2')], calls, {'steps': [['a'], ['b']]})
        self.assertFalse(results[0]['ok'])
        self.assertNotIn('repetida', results[0])
        self.assertEqual(len(calls), 2)

    def test_attempts_does_not_spend_an_attempt_on_a_failed_start(self):
        prompts, calls = [], []
        queue = [(1, 'did not become healthy'), (0, 'ok')]
        def run(*a, **kw):
            calls.append(a); return queue.pop(0)
        def claude(*a, **kw):
            prompts.append(a[0]); return 'hecho'
        def git(path, *args, **kw):
            raise equipo.Stop('revisión')                      # the tests passed: the next step is the review
        spec = {'titulo': 'x', 'archivos': ['alfred-os/app/board.tsx'], 'pruebas': ['demo']}
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.dict(equipo.LIMITS, {'attempts': 2}), \
             mock.patch.object(equipo, 'claude', claude), \
             mock.patch.object(equipo, 'run', run), \
             mock.patch.object(equipo, 'git', git), \
             mock.patch.object(equipo, 'project', lambda pid: {'tests': {'demo': {'cmd': ['node', '--test']}}}), \
             mock.patch.object(equipo, 'sleep_clock', lambda: 0), \
             mock.patch.object(equipo, 'changed', lambda *a, **kw: (['alfred-os/app/board.tsx'], [])), \
             mock.patch.object(equipo, 'phase', lambda *a, **kw: None), \
             mock.patch.object(equipo, 'lessons_text', lambda *a, **kw: ''), \
             mock.patch.object(equipo, 'context_text', lambda *a, **kw: ''), \
             mock.patch.object(equipo, 'discard', lambda *a, **kw: None), \
             mock.patch.object(equipo, 'log', lambda *a, **kw: None):
            with self.assertRaises(equipo.Stop) as ctx:
                equipo.attempts('owner-os', {'name': 'Owner OS'}, spec, {'id': 't_1'}, 'equipo/owner-os', 'b', Path(tmp), Path(tmp), {'ciclos': []}, None)
        self.assertEqual((len(prompts), len(calls), str(ctx.exception)), (1, 2, 'revisión'))
        self.assertNotIn('las pruebas fallaron', prompts[0])


class Asleep(unittest.TestCase):
    """15/10: on battery the Mac slept mid-test and six Alfa tasks were blocked for failures that were only sleep."""
    def run_tests(self, clock, code):
        ticks = iter(clock)
        with mock.patch.object(equipo, 'sleep_clock', lambda: next(ticks)), \
             mock.patch.object(equipo, 'run', lambda *a, **k: (code, 'test timed out after 30000ms')), \
             mock.patch.object(equipo, 'project', lambda pid: {'tests': {'unitarias': {'cmd': ['node', '--test']}}}):
            return equipo.run_tests('alfa', {'pruebas': ['unitarias']}, Path('/tmp'), Path('/tmp/x'), None)

    def test_a_test_frozen_by_sleep_is_not_a_failure(self):
        with self.assertRaises(equipo.Asleep): self.run_tests([0, 900], 1)

    def test_a_real_failure_while_awake_still_fails(self):
        self.assertFalse(self.run_tests([0, 3], 1)[0]['ok'])
        self.assertTrue(self.run_tests([0, 900], 0)[0]['ok'])                     # slept but passed: nothing to undo

    @unittest.skipUnless(sys.platform == 'darwin', 'la tapa solo se mira en macOS')
    def test_no_new_work_with_the_lid_closed_unless_a_display_keeps_it_awake(self):
        def lid(closed, sleeps):
            out = f'  "AppleClamshellCausesSleep" = {sleeps}\n  "AppleClamshellState" = {closed}\n'
            with mock.patch.object(equipo.subprocess, 'run', return_value=mock.Mock(stdout=out)): return equipo.lid_will_sleep()
        self.assertEqual([lid('Yes', 'Yes'), lid('Yes', 'No'), lid('No', 'Yes')], [True, False, False])

    def test_requeued_with_an_interrupted_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp); folder = state / 'runs' / 't_1'; folder.mkdir(parents=True)
            equipo.save(folder / 'receipt.json', {'tarea': 't_1', 'estado': 'bloqueada', 'ciclos': [{'pruebas': [{'ok': False, 'fallo': 'x'}]}]})
            reclaimed = []
            @equipo.contextmanager
            def board(pid): yield 'conn'
            with mock.patch.object(equipo, 'STATE', state), mock.patch.object(equipo, 'board', board), \
                 mock.patch.object(equipo.kb, 'reclaim_task', lambda conn, tid, **k: reclaimed.append(tid) or True):
                self.assertEqual(equipo.requeue_asleep('alfa', {'id': 't_1'}, 'reposo'), 'interrumpida')
            receipt = equipo.load(folder / 'receipt.json', {})
            self.assertEqual((reclaimed, receipt['estado'], equipo.relaunch_note(receipt)), (['t_1'], 'interrumpida', ''))

    def test_owner_requeues_without_the_old_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp); folder = state / 'runs' / 't_1'; folder.mkdir(parents=True)
            equipo.save(folder / 'receipt.json', {'estado': 'bloqueada', 'error': 'test timed out', 'ciclos': [{'pruebas': [{'ok': False, 'fallo': 'x'}]}]})
            unblocked, archived = [], []
            @equipo.contextmanager
            def board(pid): yield 'conn'
            with mock.patch.object(equipo, 'STATE', state), mock.patch.object(equipo, 'board', board), \
                 mock.patch.object(equipo.kb, 'unblock_task', lambda conn, tid: unblocked.append(tid) or True), \
                 mock.patch.object(equipo.kb, 'archive_task', lambda conn, tid, **k: archived.append(tid) or True):
                self.assertEqual(equipo.desbloquear('alfa', ['t_1'], limpio=True), {'t_1': 'a la cola'})
                self.assertEqual(equipo.archivar('alfa', ['t_2']), {'t_2': 'archivada'})
            self.assertEqual((unblocked, archived, equipo.relaunch_note(equipo.load(folder / 'receipt.json', {}))), (['t_1'], ['t_2'], ''))


class RecordarDecisiones(unittest.TestCase):
    """15/10: a batch that keeps a team idle for hours reaches Owner once, with how to approve it."""
    def run_at(self, hour, created_hours_ago, statuses, sent_before=None):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp); at = equipo.now().replace(hour=hour, minute=0, second=0, microsecond=0)
            (state / 'proposals').mkdir(parents=True)
            equipo.save(state / 'proposals' / f'{equipo.today()}.json', {'proyectos': {'alfa': {
                'estado': 'pendiente', 'creado': (at - equipo.timedelta(hours=created_hours_ago)).isoformat(), 'tareas': [{}, {}]}}})
            if sent_before: equipo.save(state / 'recordatorios.json', sent_before)
            notes = []
            with mock.patch.object(equipo, 'STATE', state), mock.patch.object(equipo, 'notify', lambda t, x: notes.append(x)), \
                 mock.patch.object(equipo, 'tasks', lambda pid, *a: [{'status': s} for s in statuses]):
                first = equipo.recordar_decisiones(at); again = equipo.recordar_decisiones(at)
            return first, again, notes

    def test_reminds_once_when_the_team_is_idle(self):
        first, again, notes = self.run_at(17, 4, ['done', 'blocked'])
        self.assertEqual((first, again, len(notes)), (['alfa'], [], 1))
        self.assertIn('2 tareas', notes[0]); self.assertIn('4 h', notes[0]); self.assertIn('/lote', notes[0])

    def test_no_reminder_too_soon_at_night_or_while_the_team_works(self):
        self.assertEqual(self.run_at(17, 1, ['done'])[0], [])                 # waiting only one hour
        self.assertEqual(self.run_at(22, 6, ['done'])[0], [])                 # night
        self.assertEqual(self.run_at(17, 6, ['running'])[0], [])              # the team still has work
        self.assertEqual(self.run_at(17, 6, ['done'], {f'{equipo.today()}:alfa': 'x'})[0], [])   # already reminded today
