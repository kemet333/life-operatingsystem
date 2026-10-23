import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './database.mjs';

const localRoot = path.dirname(fileURLToPath(import.meta.url));
// Two projects of this copy's built-in portfolio (the owner's or the open-source example), so the fixtures are valid in both.
const [P1, P2] = [...fs.readFileSync(path.resolve(localRoot, '../../alfred-os/lib/alfred-data.ts'), 'utf8').matchAll(/\{id:'([\w-]+)',division:/g)].map(m => m[1]);
const testRoot = path.resolve(localRoot, '../../../work/local-os-tests');
fs.mkdirSync(testRoot, { recursive: true, mode: 0o700 });
const runRoot = fs.mkdtempSync(path.join(testRoot, 'run-'));
const serverFile = path.join(localRoot, 'dist/server.mjs');
const LIMITS = {};
const limitsFile = path.resolve(localRoot, '../../alfred-os/lib/office-limits.ts');
const limitPattern = /^export const (\w+)\s*=\s*(\d+);/gm;
for (const [, name, value] of fs.readFileSync(limitsFile, 'utf8').matchAll(limitPattern)) {
  LIMITS[name] = Number(value);
}
for (const name of ['REVISE_FEEDBACK_MAX', 'REQUEST_BODY_MAX', 'ENTRY_TITLE_MAX', 'ENTRY_BODY_MAX', 'RESULTADO_MIN', 'RESULTADO_MAX']) {
  assert.ok(Number.isInteger(LIMITS[name]) && LIMITS[name] > 0, name + ' must be a positive integer in office-limits.ts');
}
const checks = [];
const processes = new Set();
let current;

function fixture() {
  const at = 1700000000000;
  return {
    version: 1, source: 'isolated-runtime-fixture', exportedAt: '2023-11-14T22:13:20.000Z',
    entries: [
      { id: 'imported-queued', kind: 'request', project: P1, title: 'Imported queued test', body: 'Synthetic fixture only.', status: 'queued', role: 'radar', created_at: at, updated_at: at },
      { id: 'imported-active', kind: 'request', project: P1, title: 'Imported active test', body: 'Synthetic fixture only.', status: 'dispatching', role: 'radar', created_at: at + 1, updated_at: at + 1 },
    ],
    office: [
      { id: 'settings', value: JSON.stringify({ focus: P2, energy: 'normal', action: 'Synthetic next step' }), updated_at: at },
      { id: 'focus-session', value: JSON.stringify({ id: 'isolated-focus', revision: 1, project: P2, title: 'Synthetic focus', doneWhen: 'Synthetic result saved', minutes: 5, status: 'paused', note: 'Existing synthetic note', elapsed: 1000, startedAt: null, completedAt: null, updatedAt: at }), updated_at: at },
    ],
  };
}

async function check(name, fn) {
  const started = Date.now();
  try {
    await fn();
    checks.push({ name, passed: true, durationMs: Date.now() - started });
    console.log('PASS ' + name);
  } catch (error) {
    checks.push({ name, passed: false, durationMs: Date.now() - started, error: error.message });
    console.log('FAIL ' + name + ': ' + error.message);
    throw error;
  }
}

function inspect(directory, fn) {
  const db = new DatabaseSync(path.join(directory, 'workspace.sqlite'), { readOnly: true });
  try { return fn(db); } finally { db.close(); }
}

async function start(directory) {
  const child = spawn(process.execPath, [serverFile], {
    cwd: localRoot,
    env: { ...process.env, LIFE_OS_DATA_DIR: directory, LIFE_OS_DISABLE_BRIDGE: '1', LIFE_OS_DISABLE_TELEGRAM: '1', LIFE_OS_CLAUDE_BIN: '/usr/bin/false', LIFE_OS_EQUIPO: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  processes.add(child);
  let buffer = '', stderr = '';
  child.stderr.on('data', piece => { stderr = (stderr + piece.toString()).slice(-5000); });
  child.on('exit', () => processes.delete(child));
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Isolated server did not become ready')); }, 10000);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Cannot start isolated server')); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Isolated server exited before ready: ' + code + '\n' + stderr)); });
    child.stdout.on('data', piece => {
      buffer += piece.toString();
      const match = buffer.match(/^READY (.+)$/m);
      if (match) {
        clearTimeout(timer);
        try { resolve(JSON.parse(match[1])); } catch { reject(new Error('Invalid local startup response')); }
      }
    });
  });
  return { child, ...ready, cookie: null };
}

async function stop(server) {
  if (server.child.exitCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => server.child.kill('SIGKILL'), 7000);
    server.child.once('exit', () => { clearTimeout(timer); resolve(); });
    server.child.stdin.end();
  });
}

async function request(route, options = {}) {
  const headers = { ...options.headers };
  const cookie = options.cookie === undefined ? current.cookie : options.cookie;
  if (cookie) headers.Cookie = cookie;
  if (options.origin !== undefined) headers.Origin = options.origin;
  if (options.value !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(current.origin + route, {
    method: options.method || 'GET', headers,
    body: options.value === undefined ? undefined : JSON.stringify(options.value),
    redirect: 'manual', signal: AbortSignal.timeout(5000),
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch {}
  return { status: response.status, headers: response.headers, text, data };
}

const post = (route, value) => request(route, { method: 'POST', origin: current.origin, value });

function rawHostStatus(host) {
  return new Promise((resolve, reject) => {
    const req = http.get(current.origin + '/api/office', { headers: { Host: host, Cookie: current.cookie } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    req.setTimeout(5000, () => req.destroy(new Error('Raw HTTP timeout')));
    req.on('error', reject);
  });
}

async function bootstrap() {
  const response = await request('/?native=1&view=now', { cookie: null, headers: { 'X-Life-Launch': current.bootstrapToken } });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Path=\//i);
  current.cookie = setCookie.split(';')[0];
  assert.ok(!response.text.includes(current.bootstrapToken), 'Launch token must not appear in HTML');
  assert.ok(!response.text.includes(current.cookie.slice('life_local='.length)), 'Session must not appear in HTML');
  assert.ok(!setCookie.includes(current.bootstrapToken), 'Launch token is not the session cookie');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(response.headers.get('content-security-policy')?.includes("connect-src 'self'"));
}

try {
  await check('database permissions, D1 results and atomic batch rollback', async () => {
    const directory = path.join(runRoot, 'database');
    const db = openDatabase(directory);
    try {
      if (process.platform !== 'win32') assert.equal(fs.statSync(directory).mode & 0o777, 0o700);   // Windows has no POSIX modes
      if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(directory, 'workspace.sqlite')).mode & 0o777, 0o600);   // Windows has no POSIX modes
      const inserted = await db.DB.prepare('INSERT INTO office VALUES (?,?,?)').bind('one', '{"n":1}', 1).run();
      assert.equal(inserted.meta.changes, 1);
      assert.equal(await db.DB.prepare('SELECT value FROM office WHERE id=?').bind('one').first('value'), '{"n":1}');
      const rows = await db.DB.prepare('SELECT id FROM office').all();
      assert.deepEqual(rows.results.map(row => ({ ...row })), [{ id: 'one' }]);
      await assert.rejects(db.DB.batch([
        db.DB.prepare('INSERT INTO office VALUES (?,?,?)').bind('rollback-me', '{}', 2),
        db.DB.prepare('INSERT INTO office VALUES (?,?,?)').bind('one', '{}', 3),
      ]));
      assert.equal(await db.DB.prepare('SELECT id FROM office WHERE id=?').bind('rollback-me').first(), null);
      const changed = await db.DB.prepare('UPDATE office SET value=? WHERE id=? RETURNING id').bind('{"n":2}', 'one').all();
      assert.equal(changed.meta.changes, 1);
      assert.deepEqual(changed.results.map(row => ({ ...row })), [{ id: 'one' }]);
    } finally { db.close(); }
  });

  await check('invalid initial import rolls back every row', async () => {
    const directory = path.join(runRoot, 'invalid-import');
    const db = openDatabase(directory);
    try {
      const data = fixture(); data.entries.push({ ...data.entries[0], id: 'bad', kind: 'invalid' });
      const file = path.join(directory, 'initial-import.json'); fs.writeFileSync(file, JSON.stringify(data));
      assert.throws(() => db.importInitial(file));
      assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM entries').get().n, 0);
      assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM office').get().n, 0);
      assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM local_metadata').get().n, 0);
    } finally { db.close(); }
  });

  await check('outer transaction rolls back nested batch and admission together', async () => {
    const db = openDatabase(path.join(runRoot, 'transaction'));
    try {
      await assert.rejects(db.transaction(async () => {
        await db.DB.batch([db.DB.prepare('INSERT INTO office VALUES (?,?,?)').bind('atomic-work', '{}', 1)]);
        db.sqlite.prepare('INSERT INTO local_admissions VALUES (?,?)').run('atomic-work', 1);
        throw new Error('Synthetic interruption before commit');
      }));
      assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM office').get().n, 0);
      assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM local_admissions').get().n, 0);
      await db.transaction(async () => {
        await db.DB.batch([db.DB.prepare('INSERT INTO office VALUES (?,?,?)').bind('atomic-work', '{}', 2)]);
        db.sqlite.prepare('INSERT INTO local_admissions VALUES (?,?)').run('atomic-work', 2);
      });
      assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM office').get().n, 1);
      assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM local_admissions').get().n, 1);
    } finally { db.close(); }
  });

  await check('equipo actions build exact args and refuse bad ids, projects and short results', async () => {
    const require = createRequire(process.env.LIFE_OS_DEPS_DIR ? path.join(process.env.LIFE_OS_DEPS_DIR, 'package.json') : path.resolve(localRoot, '../../alfred-os/package.json'));
    const bundle = path.join(runRoot, 'equipo-acciones.mjs');
    await require('esbuild').build({ entryPoints: [path.join(localRoot, 'equipo-acciones.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node26', logLevel: 'warning' });
    const { experimentoArgs, lanzadoBoton, decisionExperimentoBoton, BOTON_DECIDIR, BOTON_LANZADO, BOTON_MEDIDO, BOTON_NO_LANZO, BOTON_FUSIONAR, boton, medidoBoton, noLanzoBoton, fusionarBoton, experimentosPendientes, decisionDeTexto } = await import(pathToFileURL(path.join(runRoot, 'equipo-acciones.mjs')).href);
    const texto = 'Medí 12 clics en 3 días y salió bien.';
    assert.deepEqual(experimentoArgs({ action: 'lanzado', tarea: 't_036cee09' }), { args: ['lanzado', 't_036cee09', '--via', 'app'] });
    for (const tarea of ['', '../x', 't;rm', '--texto', '-abc', '_abc', 'a'.repeat(81)]) assert.equal(experimentoArgs({ action: 'lanzado', tarea }).error, 'Tarea no válida.');
    for (const tarea of ['t_036cee09', 'a'.repeat(80)]) assert.deepEqual(experimentoArgs({ action: 'lanzado', tarea }), { args: ['lanzado', tarea, '--via', 'app'] });
    assert.equal(experimentoArgs({ action: 'resultado', project: 'demo', texto, tarea: '--x' }).error, 'Tarea no válida.');
    assert.equal(experimentoArgs({ action: 'lanzado' }).error, 'Tarea no válida.');
    for (const decision of ['seguir', 'cambiar', 'parar']) assert.deepEqual(experimentoArgs({ action: 'decidir', tarea: 't_036cee09', decision }), { args: ['decidir', 't_036cee09', '--decision', decision] });
    for (const tarea of ['', '../x', '-abc', undefined]) assert.equal(experimentoArgs({ action: 'decidir', tarea, decision: 'seguir' }).error, 'Tarea no válida.');
    for (const decision of ['quizá', '', undefined]) assert.equal(experimentoArgs({ action: 'decidir', tarea: 't_036cee09', decision }).error, 'Decisión no válida.');
    assert.deepEqual(experimentoArgs({ action: 'decidir', tarea: ' t_036cee09 ', decision: ' seguir ' }), { args: ['decidir', 't_036cee09', '--decision', 'seguir'] });
    assert.equal(BOTON_DECIDIR, 'e:');
    assert.deepEqual(decisionExperimentoBoton('e:parar:t_036cee09'), ['decidir', 't_036cee09', '--decision', 'parar']);
    for (const data of ['e:x:t_1', 'e:parar:../x', 'l:t_1', 'd:tf:5:s']) assert.equal(decisionExperimentoBoton(data), null);
    assert.deepEqual(experimentoArgs({ action: 'resultado', project: 'demo', texto }), { args: ['resultado', 'demo', '--texto', texto] });
    assert.deepEqual(experimentoArgs({ action: 'resultado', project: 'demo', texto, tarea: 't_036cee09' }), { args: ['resultado', 'demo', '--texto', texto, '--experimento', 't_036cee09'] });
    assert.equal(experimentoArgs({ action: 'resultado', project: 'demo', texto, tarea: '../x' }).error, 'Tarea no válida.');
    assert.equal(experimentoArgs({ action: 'resultado', project: 'demo', texto: 'x'.repeat(LIMITS.RESULTADO_MIN - 1) }).error, 'Cuenta qué mediste y qué salió (mínimo 10 caracteres).');
    assert.equal(experimentoArgs({ action: 'resultado', project: 'demo', texto: 'x'.repeat(LIMITS.RESULTADO_MIN) }).args[3].length, LIMITS.RESULTADO_MIN);
    assert.equal(experimentoArgs({ action: 'resultado', project: 'demo', texto: 'x'.repeat(LIMITS.RESULTADO_MAX + 100) }).args[3].length, LIMITS.RESULTADO_MAX);
    assert.equal(experimentoArgs({ action: 'resultado', project: 'Alfa!', texto }).error, 'Proyecto no válido.');
    for (const decision of ['seguir', 'cambiar', 'parar']) {
      assert.deepEqual(experimentoArgs({ action: 'resultado', project: 'demo', texto, tarea: 't_036cee09', decision }), { args: ['resultado', 'demo', '--texto', texto, '--experimento', 't_036cee09', '--decision', decision] });
      assert.deepEqual(experimentoArgs({ action: 'resultado', project: 'demo', texto, decision }), { args: ['resultado', 'demo', '--texto', texto, '--decision', decision] });
    }
    assert.equal(experimentoArgs({ action: 'resultado', project: 'demo', texto, decision: 'quizá' }).error, 'Decisión no válida.');
    assert.equal(decisionDeTexto('Parar: 0 clics'), 'parar');
    assert.equal(decisionDeTexto('  seguir. 12 altas'), 'seguir');
    assert.equal(decisionDeTexto('cambiar'), 'cambiar');
    assert.equal(decisionDeTexto('pararé luego'), null);
    assert.equal(decisionDeTexto('separar'), null);
    assert.equal(decisionDeTexto(null), null);
    const motivo = 'No tengo tiempo para lanzarlo esta semana.';
    assert.deepEqual(experimentoArgs({ action: 'descartar', tarea: 't_036cee09', texto: motivo }), { args: ['descartar', 't_036cee09', '--texto', motivo] });
    for (const tarea of ['', '../x', 't;rm', '--texto', '-abc', '_abc', 'a'.repeat(81)]) assert.equal(experimentoArgs({ action: 'descartar', tarea, texto: motivo }).error, 'Tarea no válida.');
    assert.equal(experimentoArgs({ action: 'descartar', texto: motivo }).error, 'Tarea no válida.');
    assert.equal(experimentoArgs({ action: 'descartar', tarea: 't_036cee09', texto: 'x'.repeat(LIMITS.RESULTADO_MIN - 1) }).error, `Cuenta por qué no lo lanzas (mínimo ${LIMITS.RESULTADO_MIN} caracteres).`);
    assert.equal(experimentoArgs({ action: 'descartar', tarea: 't_036cee09', texto: 'x'.repeat(LIMITS.RESULTADO_MIN) }).args[3].length, LIMITS.RESULTADO_MIN);
    assert.equal(experimentoArgs({ action: 'descartar', tarea: 't_036cee09', texto: 'x'.repeat(LIMITS.RESULTADO_MAX + 100) }).args[3].length, LIMITS.RESULTADO_MAX);
    assert.deepEqual(lanzadoBoton('l:t_036cee09'), { args: ['lanzado', 't_036cee09', '--via', 'telegram'] });
    for (const data of ['l:../x', 'l:-abc', 'l:', 'a:alfa', 'x', '']) assert.equal(lanzadoBoton(data), null);
    assert.equal(BOTON_LANZADO, 'l:');
    assert.equal(BOTON_FUSIONAR, 'f:');
    assert.equal(fusionarBoton('f:demo'), 'demo');
    assert.equal(fusionarBoton('f:betalabs'), 'betalabs');
    for (const data of ['f:', 'f:A', 'f:' + 'a'.repeat(31), 'f:x', 'l:demo', 'f:demo x']) assert.equal(fusionarBoton(data), null);
    assert.equal(lanzadoBoton(BOTON_LANZADO + 'a'.repeat(81)), null);
    for (const tarea of ['t_036cee09', 'a'.repeat(80)]) assert.deepEqual(lanzadoBoton(BOTON_LANZADO + tarea), { args: ['lanzado', tarea, '--via', 'telegram'] });
    assert.equal(BOTON_MEDIDO, 'm:');
    assert.equal(boton('l:', 't_036cee09'), 'l:t_036cee09');
    assert.equal(boton('l:', 'a'.repeat(80)), null);
    assert.equal(boton('m:', '../x'), null);
    assert.equal(medidoBoton('m:t_036cee09'), 't_036cee09');
    for (const data of ['m:../x', 'm:', 'l:t_036cee09', '']) assert.equal(medidoBoton(data), null);
    assert.equal(BOTON_NO_LANZO, 'n:');
    assert.equal(noLanzoBoton('n:t_036cee09'), 't_036cee09');
    for (const data of ['n:../x', 'n:', 'm:t_036cee09', '', 'n:' + 'a'.repeat(81)]) assert.equal(noLanzoBoton(data), null);
    const lanzamiento = { que: 'Q', a_quien: 'A', metrica: 'M', umbral: 'U' };
    const { porLanzar, faltaMedir } = experimentosPendientes([
      { id: 't_por_lanzar', fuente: 'equipo', columna: 'para-ti', lanzamiento },
      { id: 't_falta_medir', fuente: 'equipo', columna: 'hecho', lanzamiento, lanzado: '2026-10-10T10:00:00', fase: 'falta medir' },
      { id: 't_medido', fuente: 'equipo', columna: 'hecho', lanzamiento, lanzado: '2026-10-10T10:00:00', medido: '2026-10-15T10:00:00', fase: 'falta medir' },
      { id: 't_mesa', fuente: 'mesa', columna: 'para-ti', lanzamiento, lanzado: '2026-10-10T10:00:00', fase: 'falta medir' },
    ]);
    assert.deepEqual(porLanzar.map(it => it.id), ['t_por_lanzar']);
    assert.deepEqual(faltaMedir.map(it => it.id), ['t_falta_medir']);
    const { decisionesExperimentos } = await import(pathToFileURL(bundle).href);
    assert.deepEqual(decisionesExperimentos([]), []);
    assert.deepEqual(decisionesExperimentos(undefined), []);
    const porLanzarItem = id => ({ id, fuente: 'equipo', columna: 'para-ti', lanzamiento });
    const faltaMedirItem = { id: 't_falta_medir', fuente: 'equipo', columna: 'hecho', lanzamiento, lanzado: '2026-10-10T10:00:00', fase: 'falta medir' };
    assert.deepEqual(decisionesExperimentos([porLanzarItem('t_a'), porLanzarItem('t_b'), faltaMedirItem]), ['lanzar 2 experimentos (/lote)', 'apuntar lo medido de 1 experimento (/lote)']);
    assert.deepEqual(decisionesExperimentos([porLanzarItem('t_a')]), ['lanzar 1 experimento (/lote)']);
    const faltaDecidirItem = { ...faltaMedirItem, id: 't_falta_decidir', medido: '2026-10-15T10:00:00', fase: 'falta decidir' };
    const pendientes = experimentosPendientes([
      faltaDecidirItem,
      { ...faltaDecidirItem, id: 't_decidido', decision: 'seguir' },
      { ...faltaDecidirItem, id: 't_mesa_decidir', fuente: 'mesa' },
      { ...faltaDecidirItem, id: 't_sin_lanzamiento', lanzamiento: null },
      { ...faltaDecidirItem, id: 't_sin_lanzar', lanzado: null },
      { ...faltaDecidirItem, id: 't_sin_medir', medido: null },
      { ...faltaDecidirItem, id: 't_otra_fase', fase: 'hecho' },
    ]);
    assert.deepEqual(pendientes.faltaDecidir.map(it => it.id), ['t_falta_decidir']);
    assert.deepEqual(pendientes.porLanzar, []);
    assert.deepEqual(pendientes.faltaMedir, []);
    assert.deepEqual(decisionesExperimentos([porLanzarItem('t_a'), faltaMedirItem, faltaDecidirItem]), ['lanzar 1 experimento (/lote)', 'apuntar lo medido de 1 experimento (/lote)', 'decidir 1 experimento (/lote)']);
    assert.deepEqual(decisionesExperimentos([faltaDecidirItem, { ...faltaDecidirItem, id: 't_otro' }]), ['decidir 2 experimentos (/lote)']);
  });

  await check('telegram reply to the measure question finds its experiment again from the quoted text', async () => {
    const { preguntaMedido, experimentoDeRespuesta, preguntaFreno, experimentoDeFreno } = await import(pathToFileURL(path.join(runRoot, 'equipo-acciones.mjs')).href);
    assert.equal(preguntaMedido('Anuncio medible'), '¿Qué mediste en «Anuncio medible»? Respóndeme a este mensaje.');
    const a = { id: 't_a', titulo: 'Anuncio medible' }, b = { id: 't_b', titulo: 'Otro anuncio' }, c = { id: 't_c', titulo: 'Prueba «x» de precio' };
    assert.equal(experimentoDeRespuesta(preguntaMedido(a.titulo), [b, a]), a);
    assert.equal(experimentoDeRespuesta(preguntaMedido(c.titulo), [a, c]), c);
    assert.equal(experimentoDeRespuesta(preguntaMedido(a.titulo), [a, { ...a, id: 't_dup' }]), null);
    assert.equal(experimentoDeRespuesta('Te respondo sobre «Anuncio medible»', [a]), null);
    assert.equal(experimentoDeRespuesta('', [a]), null);
    assert.equal(experimentoDeRespuesta(undefined, [a]), null);
    assert.equal(experimentoDeRespuesta(preguntaMedido(a.titulo), []), null);
    assert.equal(experimentoDeFreno(preguntaFreno(a.titulo), [b, a]), a);
    assert.equal(experimentoDeFreno(preguntaFreno(a.titulo), [a, { ...a, id: 't_dup' }]), null);
    assert.equal(experimentoDeFreno(preguntaMedido(a.titulo), [a]), null);
    assert.equal(experimentoDeFreno('', [a]), null);
    assert.equal(experimentoDeFreno(undefined, [a]), null);
    assert.equal(experimentoDeFreno(preguntaFreno(a.titulo), []), null);
  });

  await check('telegram morning to-do puts experiments before the other decisions', async () => {
    const { decisionesDelEquipo } = await import(pathToFileURL(path.join(runRoot, 'equipo-acciones.mjs')).href);
    const lanzamiento = { que: 'Q', a_quien: 'A', metrica: 'M', umbral: 'U' };
    const proyecto = nombre => ({ nombre, lote: { estado: 'pendiente', tareas: [{ id: 't' }] }, por_fusionar: 2 });
    const status = {
      proyectos: { a: proyecto('A'), b: proyecto('B'), c: proyecto('C') },
      mesa: { mensajes: [{ id: 'm1', de: 'control', para: ['owner'], tipo: 'pregunta' }, { id: 'm2', de: 'radar', para: ['owner'], tipo: 'aviso' }] },
      tablero: [
        { id: 't_a', fuente: 'equipo', columna: 'para-ti', lanzamiento },
        { id: 't_b', fuente: 'equipo', columna: 'para-ti', lanzamiento },
        { id: 't_m', fuente: 'equipo', columna: 'hecho', lanzamiento, lanzado: '2026-10-10T10:00:00', fase: 'falta medir' },
      ],
    };
    const lines = decisionesDelEquipo(status);
    assert.deepEqual(lines.slice(0, 2), ['lanzar 2 experimentos (/lote)', 'apuntar lo medido de 1 experimento (/lote)']);
    assert.ok(lines.slice(0, 5).includes('lanzar 2 experimentos (/lote)') && lines.slice(0, 5).includes('apuntar lo medido de 1 experimento (/lote)'));
    assert.equal(lines[2], 'decidir 1 cosa de A (/lote)');
    assert.equal(lines.at(-1), 'responder 1 pregunta del equipo (/mesa)');   // warnings do not count as questions
    assert.equal(decisionesDelEquipo({ ...status, tablero: undefined })[0], 'decidir 1 cosa de A (/lote)');
    assert.deepEqual(decisionesDelEquipo(undefined), []);
    assert.deepEqual(decisionesDelEquipo({}), []);
  });

  await check('telegram grouped decisions include measured experiments first and offer their messages', async () => {
    const { decisionesDelEquipo, mensajesFaltaDecidir } = await import(pathToFileURL(path.join(runRoot, 'equipo-acciones.mjs')).href);
    const item = { id: 't_falta_decidir', proyecto: 'a', titulo: 'Experimento', fuente: 'equipo', lanzamiento: { metrica: 'M', umbral: 'U' }, lanzado: '2026-10-10T10:00:00', medido: '2026-10-15T10:00:00', fase: 'falta decidir' };
    const status = { proyectos: { a: { nombre: 'A' } }, para_ti: [{ tipo: 'lanzar', titulo: 'Lanzar la campaña', claves: ['l:t_otro'] }], tablero: [item] };
    assert.deepEqual(decisionesDelEquipo(status), ['decidir 1 experimento (/lote)', 'lanzar la campaña (/lote)']);
    assert.deepEqual(decisionesDelEquipo({ ...status, tablero: [] }), ['lanzar la campaña (/lote)']);
    assert.deepEqual(decisionesDelEquipo({ ...status, tablero: [item, { ...item, id: 't_otro' }] }), ['decidir 2 experimentos (/lote)', 'lanzar la campaña (/lote)']);
    const texto = 'A — falta decidir: «Experimento»\nMétrica: M\nUmbral: U';
    assert.deepEqual(mensajesFaltaDecidir(status), [{ texto, reply_markup: { inline_keyboard: [[
      { text: 'Seguir', callback_data: 'e:seguir:t_falta_decidir' },
      { text: 'Cambiar', callback_data: 'e:cambiar:t_falta_decidir' },
      { text: 'Parar', callback_data: 'e:parar:t_falta_decidir' },
    ]] } }]);
    assert.deepEqual(mensajesFaltaDecidir({ ...status, tablero: [{ ...item, id: 'a'.repeat(81) }] }), [{ texto }]);
    assert.deepEqual(mensajesFaltaDecidir({ ...status, proyectos: {} })[0].texto, 'a — falta decidir: «Experimento»\nMétrica: M\nUmbral: U');
    assert.deepEqual(mensajesFaltaDecidir(undefined), []);
    assert.deepEqual(mensajesFaltaDecidir({}), []);
    assert.deepEqual(mensajesFaltaDecidir({ tablero: {} }), []);
  });

  await check('telegram launch groups warn and offer merging only for pending members', async () => {
    const { fusionPendienteDeGrupo, textoGrupo, botonesGrupo, mensajesFusion } = await import(pathToFileURL(path.join(runRoot, 'equipo-acciones.mjs')).href);
    const g = { id: '1234abcd', tipo: 'lanzar', titulo: 'Lanzar el experimento', claves: ['l:t_lanza'] };
    const item = { id: 't_lanza', fuente: 'equipo', fase: 'lista para lanzar · falta fusionar', proyecto: 'demo' };
    const original = { inline_keyboard: [[
      { text: '✓ Hecho, ya está', callback_data: 'g:1234abcd:h' },
      { text: 'Ahora no', callback_data: 'g:1234abcd:l' },
      { text: '✕ No lo haré', callback_data: 'g:1234abcd:x' },
    ]] };
    const aviso = 'Antes de lanzarlo: aún no está en la versión principal. Pulsa «Fusionar ahora» o espera a la fusión de esta noche.';
    assert.equal(fusionPendienteDeGrupo(g, [item]), 'demo');
    assert.deepEqual(botonesGrupo(g, [item]), { inline_keyboard: [...original.inline_keyboard, [{ text: 'Fusionar ahora', callback_data: 'f:demo' }]] });
    assert.equal(textoGrupo(g, [item]), '📣 Lanzar el experimento\n' + aviso);
    assert.deepEqual(botonesGrupo(g, [{ ...item, fase: 'lista para lanzar' }]), original);
    assert.equal(textoGrupo(g, [{ ...item, fase: 'lista para lanzar' }]), textoGrupo(g));
    assert.equal(fusionPendienteDeGrupo({ ...g, tipo: 'medir' }, [item]), null);
    assert.equal(fusionPendienteDeGrupo({ ...g, claves: ['l:t_desconocida'] }, [item]), null);
    assert.equal(fusionPendienteDeGrupo({ ...g, claves: ['m:t_lanza'] }, [item]), null);
    assert.equal(fusionPendienteDeGrupo(g, [{ ...item, fuente: 'otra' }]), null);
    assert.equal(fusionPendienteDeGrupo(g, [{ ...item, proyecto: 'Proyecto demo' }]), null);
    assert.equal(fusionPendienteDeGrupo(g, {}), null);
    assert.deepEqual(botonesGrupo(g), original);
    assert.equal(textoGrupo(g), '📣 Lanzar el experimento');
    assert.ok(new TextEncoder().encode(botonesGrupo(g, [item]).inline_keyboard[1][0].callback_data).length <= 64);
    const fusion = { proyectos: { 'demo': { nombre: 'Proyecto demo', por_fusionar: 2, mejoras: ['Una mejora', 'Otra mejora'] } } };
    assert.deepEqual(mensajesFusion(fusion), [{ texto: '🔗 Proyecto demo: 2 mejoras terminadas y revisadas por el equipo.\n• Una mejora\n• Otra mejora\nTu parte: decir si las junto a tu proyecto. Antes lo pruebo y solo lo junto si todo sigue funcionando.', reply_markup: { inline_keyboard: [[{ text: 'Sí, júntalas', callback_data: 'f:demo' }]] } }]);
    assert.deepEqual(mensajesFusion(fusion, ['demo']), []);
    assert.deepEqual(mensajesFusion({ proyectos: { a: { por_fusionar: 0 }, b: {} } }), []);
    assert.deepEqual(mensajesFusion({ proyectos: { a: { nombre: 'A', por_fusionar: 1 }, b: { nombre: 'B', por_fusionar: 1 } } }, ['a']), [{ texto: '🔗 B: una mejora terminada y revisada por el equipo.\nTu parte: decir si la junto a tu proyecto. Antes lo pruebo y solo lo junto si todo sigue funcionando.', reply_markup: { inline_keyboard: [[{ text: 'Sí, júntala', callback_data: 'f:b' }]] } }]);
  });

  await check('telegram offers no button when callback_data goes over 64 bytes', async () => {
    const { BOTON_LANZADO, BOTON_MEDIDO, BOTON_DECIDIR, boton } = await import(pathToFileURL(path.join(runRoot, 'equipo-acciones.mjs')).href);
    for (const prefijo of [BOTON_LANZADO, BOTON_MEDIDO, ...['seguir', 'cambiar', 'parar'].map(d => BOTON_DECIDIR + d + ':')]) {
      assert.equal(boton(prefijo, 'a'.repeat(80)), null);
      assert.equal(boton(prefijo, 't_036cee09'), prefijo + 't_036cee09');
    }
  });

  const directory = path.join(runRoot, 'runtime');
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'initial-import.json'), JSON.stringify(fixture()), { mode: 0o600 });
  current = await start(directory);

  await check('HTTP auth rejects missing/invalid cookie and misplaced launch token', async () => {
    assert.equal((await request('/api/office', { cookie: null })).status, 401);
    assert.equal((await request('/api/office', { cookie: 'life_local=invalid' })).status, 401);
    assert.equal((await request('/api/office', { cookie: null, headers: { 'X-Life-Launch': current.bootstrapToken } })).status, 401);
    const wrong = await request('/', { cookie: null, headers: { 'X-Life-Launch': 'invalid' } });
    assert.equal(wrong.status, 401); assert.equal(wrong.headers.get('set-cookie'), null);
  });

  await check('bootstrap sets private cookie without putting secrets in content', bootstrap);
  await check('import preserves history but admits no imported work', async () => {
    const response = await request('/api/office'); assert.equal(response.status, 200);
    assert.equal(response.data.settings.focus, P2);
    assert.equal(response.data.focusSession.note, 'Existing synthetic note');
    assert.equal(response.data.local.bridge, 'disabled');
    assert.equal(response.data.entries.find(e => e.id === 'imported-queued').status, 'parked');
    assert.equal(response.data.entries.find(e => e.id === 'imported-active').status, 'parked');
    assert.equal(inspect(directory, db => db.prepare('SELECT status FROM entries WHERE id=?').get('imported-queued').status), 'queued');
    assert.equal(inspect(directory, db => db.prepare('SELECT status FROM entries WHERE id=?').get('imported-active').status), 'dispatching');
    assert.equal(inspect(directory, db => db.prepare('SELECT COUNT(*) n FROM local_admissions').get().n), 0);
    assert.ok(!response.text.includes(current.bootstrapToken));
    assert.ok(!response.text.includes(current.cookie.slice('life_local='.length)));
  });

  await check('POST requires matching Origin and rejects cross-site/Host tricks', async () => {
    const value = { action: 'settings', energy: 'low' };
    assert.equal((await request('/api/office', { method: 'POST', value })).status, 403, 'Missing Origin');
    assert.equal((await request('/api/office', { method: 'POST', value, origin: 'https://example.invalid' })).status, 403, 'Foreign Origin');
    assert.equal(await rawHostStatus('example.invalid'), 403, 'Foreign Host');
    assert.equal((await request('/api/office', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403, 'Cross-site request');
    assert.equal((await post('/api/office', value)).status, 200);
    const state = (await request('/api/office')).data;
    assert.equal(state.settings.energy, 'low'); assert.equal(state.settings.focus, P2);
  });

  await check('local cookie cannot invoke reserved bridge actions', async () => {
    assert.equal((await post('/api/office', { action: 'snapshot', snapshot: {} })).status, 403);
    assert.equal((await post('/api/office', { action: 'claim', id: 'imported-queued' })).status, 403);
    assert.equal((await post('/api/bridge', { method: 'tools/call', params: {} })).status, 401);
  });

  const captureId = randomUUID();
  await check('concurrent deterministic chat retries create one idea and message pair', async () => {
    const message = { id: captureId, text: 'Guarda idea: Synthetic isolated capture.' };
    const responses = await Promise.all([post('/api/chat', message), post('/api/chat', message)]);
    responses.forEach(r => assert.equal(r.status, 200));
    assert.equal(responses.filter(r => r.data.duplicate).length, 1);
    const data = (await request('/api/office')).data;
    assert.equal(data.entries.filter(e => e.id === 'idea-' + captureId).length, 1);
    assert.equal(data.messages.filter(m => m.id === captureId && m.author === 'user').length, 1);
    assert.equal(data.messages.filter(m => m.id === captureId && m.author === 'assistant').length, 1);
    assert.equal(inspect(directory, db => db.prepare('SELECT COUNT(*) n FROM local_admissions').get().n), 0);
    assert.equal((await post('/api/chat', { id: captureId, text: 'Guarda idea: Different content.' })).status, 400);
  });

  const conversationId = randomUUID();
  await check('explicit new work is admitted once while inference stays disabled', async () => {
    const response = await post('/api/chat', { id: conversationId, text: 'Analiza esta petición sintética aislada.' });
    assert.equal(response.status, 200); assert.equal(response.data.requestId, 'chat-' + conversationId);
    const duplicate = await post('/api/chat', { id: conversationId, text: 'Analiza esta petición sintética aislada.' });
    assert.equal(duplicate.data.duplicate, true);
    assert.equal(inspect(directory, db => db.prepare('SELECT COUNT(*) n FROM local_admissions WHERE id=?').get('chat-' + conversationId).n), 1);
    assert.equal(inspect(directory, db => db.prepare("SELECT COUNT(*) n FROM local_admissions WHERE id LIKE 'imported-%'").get().n), 0);
    assert.equal((await request('/api/office')).data.entries.find(e => e.id === 'chat-' + conversationId).status, 'queued');
  });

  await check('focus writes preserve context and reject stale revisions', async () => {
    const response = await post('/api/office', { action: 'focus', command: 'note', id: 'isolated-focus', revision: 1, note: 'Updated synthetic checkpoint' });
    assert.equal(response.status, 200); assert.equal(response.data.session.revision, 2);
    assert.equal(response.data.session.project, P2); assert.equal(response.data.session.status, 'paused');
    assert.equal((await post('/api/office', { action: 'focus', command: 'note', id: 'isolated-focus', revision: 1, note: 'Stale overwrite' })).status, 400);
    assert.equal((await request('/api/office')).data.focusSession.note, 'Updated synthetic checkpoint');
  });

  await check('second instance is rejected before mutating active local work', async () => {
    const db = new DatabaseSync(path.join(directory, 'workspace.sqlite'));
    try { db.prepare("UPDATE entries SET status='dispatching' WHERE id=?").run('chat-' + conversationId); } finally { db.close(); }
    const child = spawn(process.execPath, [serverFile], {
      cwd: localRoot, env: { ...process.env, LIFE_OS_DATA_DIR: directory, LIFE_OS_DISABLE_BRIDGE: '1', LIFE_OS_DISABLE_TELEGRAM: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    processes.add(child);
    let stdout = ''; child.stdout.on('data', data => { stdout += data.toString(); }); child.stderr.on('data', () => {});
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Second instance failed to exit')); }, 7000);
      child.once('error', reject); child.once('exit', code => { clearTimeout(timer); processes.delete(child); resolve(code); });
    });
    assert.equal(code, 1); assert.ok(!stdout.includes('READY '));
    assert.equal(inspect(directory, db => db.prepare('SELECT status FROM entries WHERE id=?').get('chat-' + conversationId).status), 'dispatching');
    assert.equal((await request('/api/office')).status, 200);
  });

  await check('review can be returned with feedback and is re-admitted', async () => {
    const created = await post('/api/office', { action: 'create', kind: 'request', project: P1, role: 'radar', title: 'Synthetic revise', body: 'Synthetic body' });
    assert.equal(created.status, 200); const id = created.data.id;
    const db = new DatabaseSync(path.join(directory, 'workspace.sqlite'));
    try { db.prepare("UPDATE entries SET status='review',result=? WHERE id=?").run('Synthetic result', id); db.prepare('DELETE FROM local_admissions WHERE id=?').run(id); } finally { db.close(); }
    assert.equal((await post('/api/office', { action: 'revise', id, feedback: '   ' })).status, 400);
    for (const value of [{ action: 'revise', id, feedback: 123 }, { action: 'revise', id }]) {
      const rejected = await post('/api/office', value);
      assert.equal(rejected.status, 400); assert.equal(rejected.data.error, 'Escribe qué hay que cambiar.');
    }
    assert.equal((await post('/api/office', { action: 'revise', id, feedback: 'Synthetic feedback' })).status, 200);
    const entry = (await request('/api/office')).data.entries.find(e => e.id === id);
    assert.equal(entry.status, 'queued'); assert.equal(entry.result, 'Synthetic result');
    assert.ok(entry.body.includes('Cambios pedidos (')); assert.ok(entry.body.includes('Synthetic feedback'));
    assert.equal(inspect(directory, db => db.prepare('SELECT COUNT(*) n FROM local_admissions WHERE id=?').get(id).n), 1);
    assert.equal((await post('/api/office', { action: 'revise', id, feedback: 'Synthetic feedback' })).status, 400);
    assert.equal((await post('/api/office', { action: 'update', id, status: 'cancelled' })).status, 200);
  });

  await check('revise stops growing a request past the accumulated body limit', async () => {
    const created = await post('/api/office', { action: 'create', kind: 'request', project: P1, role: 'radar', title: 'Synthetic revise limit', body: 'x'.repeat(LIMITS.ENTRY_BODY_MAX) });
    assert.equal(created.status, 200); const id = created.data.id;
    const toReview = () => {
      const db = new DatabaseSync(path.join(directory, 'workspace.sqlite'));
      try { db.prepare("UPDATE entries SET status='review',result=? WHERE id=?").run('Synthetic result', id); db.prepare('DELETE FROM local_admissions WHERE id=?').run(id); } finally { db.close(); }
    };
    let limited = null;
    for (let round = 0; round < 10 && !limited; round++) {
      toReview();
      const before = (await request('/api/office')).data.entries.find(e => e.id === id).body;
      const response = await post('/api/office', { action: 'revise', id, feedback: 'y'.repeat(LIMITS.REVISE_FEEDBACK_MAX) });
      if (response.status === 400) limited = { response, before };
      else assert.equal(response.status, 200);
    }
    assert.ok(limited, 'Revise never hit the body limit');
    assert.equal(limited.response.data.error, 'Este encargo ya acumula demasiados cambios. Acéptalo o crea uno nuevo.');
    const entry = (await request('/api/office')).data.entries.find(e => e.id === id);
    assert.equal(entry.status, 'review'); assert.equal(entry.body, limited.before);
    assert.ok(limited.before.length <= LIMITS.REQUEST_BODY_MAX);
    assert.equal((await post('/api/office', { action: 'update', id, status: 'cancelled' })).status, 200);
  });

  await check('a reviewed request can be accepted and then stays closed', async () => {
    const created = await post('/api/office', { action: 'create', kind: 'request', project: P1, role: 'radar', title: 'Synthetic accept', body: 'Synthetic body' });
    assert.equal(created.status, 200); const id = created.data.id;
    const early = await post('/api/office', { action: 'update', id, status: 'accepted' });
    assert.equal(early.status, 400); assert.equal(early.data.error, 'Primero hace falta un resultado para revisar.');
    const db = new DatabaseSync(path.join(directory, 'workspace.sqlite'));
    try { db.prepare("UPDATE entries SET status='review',result=? WHERE id=?").run('Synthetic result', id); db.prepare('DELETE FROM local_admissions WHERE id=?').run(id); } finally { db.close(); }
    assert.equal((await post('/api/office', { action: 'update', id, status: 'accepted' })).status, 200);
    const entry = (await request('/api/office')).data.entries.find(e => e.id === id);
    assert.equal(entry.status, 'accepted'); assert.equal(entry.result, 'Synthetic result');
    assert.equal((await post('/api/office', { action: 'revise', id, feedback: 'Synthetic feedback' })).status, 400);
    assert.equal((await post('/api/office', { action: 'update', id, status: 'queued' })).status, 400);
    for (const status of ['cancelled', 'parked']) {
      const closed = await post('/api/office', { action: 'update', id, status });
      assert.equal(closed.status, 400); assert.equal(closed.data.error, 'Este encargo ya está cerrado.');
    }
    assert.equal((await request('/api/office')).data.entries.find(e => e.id === id).status, 'accepted');
  });

  await check('create trims title and body to the shared limits', async () => {
    const created = await post('/api/office', { action: 'create', kind: 'request', project: P1, role: 'radar', title: 'x'.repeat(LIMITS.ENTRY_TITLE_MAX + 20), body: 'y'.repeat(LIMITS.ENTRY_BODY_MAX + 100) });
    assert.equal(created.status, 200); const id = created.data.id;
    const entry = (await request('/api/office')).data.entries.find(e => e.id === id);
    assert.equal(entry.title.length, LIMITS.ENTRY_TITLE_MAX); assert.equal(entry.body.length, LIMITS.ENTRY_BODY_MAX);
    assert.equal((await post('/api/office', { action: 'update', id, status: 'cancelled' })).status, 200);
    const exact = await post('/api/office', { action: 'create', kind: 'request', project: P1, role: 'radar', title: 'x'.repeat(LIMITS.ENTRY_TITLE_MAX), body: 'y'.repeat(LIMITS.ENTRY_BODY_MAX) });
    assert.equal(exact.status, 200);
    const kept = (await request('/api/office')).data.entries.find(e => e.id === exact.data.id);
    assert.equal(kept.title, 'x'.repeat(LIMITS.ENTRY_TITLE_MAX)); assert.equal(kept.body, 'y'.repeat(LIMITS.ENTRY_BODY_MAX));
    assert.equal((await post('/api/office', { action: 'update', id: exact.data.id, status: 'cancelled' })).status, 200);
  });

  await check('revise keeps feedback up to the shared limit', async () => {
    const created = await post('/api/office', { action: 'create', kind: 'request', project: P1, role: 'radar', title: 'Synthetic revise feedback limit', body: 'Synthetic body' });
    assert.equal(created.status, 200); const id = created.data.id;
    const toReview = () => {
      const db = new DatabaseSync(path.join(directory, 'workspace.sqlite'));
      try { db.prepare("UPDATE entries SET status='review',result=? WHERE id=?").run('Synthetic result', id); db.prepare('DELETE FROM local_admissions WHERE id=?').run(id); } finally { db.close(); }
    };
    const bodyOf = async () => (await request('/api/office')).data.entries.find(e => e.id === id).body;
    const exact = 'f'.repeat(LIMITS.REVISE_FEEDBACK_MAX);
    toReview();
    assert.equal((await post('/api/office', { action: 'revise', id, feedback: exact })).status, 200);
    assert.ok((await bodyOf()).endsWith(exact));
    const over = 'g'.repeat(LIMITS.REVISE_FEEDBACK_MAX + 1);
    toReview();
    assert.equal((await post('/api/office', { action: 'revise', id, feedback: over })).status, 200);
    const body = await bodyOf();
    assert.ok(body.length <= LIMITS.REQUEST_BODY_MAX);
    assert.ok(body.endsWith('g'.repeat(LIMITS.REVISE_FEEDBACK_MAX)));
    assert.ok(!body.endsWith(over));
    assert.equal((await post('/api/office', { action: 'update', id, status: 'cancelled' })).status, 200);
  });

  await check('a cancelled request stays closed', async () => {
    const created = await post('/api/office', { action: 'create', kind: 'request', project: P1, role: 'radar', title: 'Synthetic cancelled', body: 'Synthetic body' });
    assert.equal(created.status, 200); const id = created.data.id;
    assert.equal((await post('/api/office', { action: 'update', id, status: 'cancelled' })).status, 200);
    const admissions = () => inspect(directory, db => db.prepare('SELECT COUNT(*) n FROM local_admissions WHERE id=?').get(id).n);
    const before = admissions();
    const accepted = await post('/api/office', { action: 'update', id, status: 'accepted' });
    assert.equal(accepted.status, 400); assert.equal(accepted.data.error, 'Primero hace falta un resultado para revisar.');
    const revised = await post('/api/office', { action: 'revise', id, feedback: 'Synthetic feedback' });
    assert.equal(revised.status, 400); assert.equal(revised.data.error, 'Solo se pueden pedir cambios sobre un resultado pendiente de revisión.');
    const parked = await post('/api/office', { action: 'update', id, status: 'parked' });
    assert.equal(parked.status, 400); assert.equal(parked.data.error, 'Este encargo ya está cerrado.');
    assert.equal((await post('/api/office', { action: 'update', id, status: 'cancelled' })).status, 200);
    assert.equal((await request('/api/office')).data.entries.find(e => e.id === id).status, 'cancelled');
    assert.equal(admissions(), before);
  });

  await check('a blocked request can be retried or cancelled, and a cancelled one stays out of the queue', async () => {
    const force = (id, status, result, kind) => {
      const db = new DatabaseSync(path.join(directory, 'workspace.sqlite'));
      try {
        db.prepare('UPDATE entries SET status=?,result=? WHERE id=?').run(status, result, id);
        if (kind) db.prepare('UPDATE entries SET kind=? WHERE id=?').run(kind, id);
        db.prepare('DELETE FROM local_admissions WHERE id=?').run(id);
      } finally { db.close(); }
    };
    const admissions = id => inspect(directory, db => db.prepare('SELECT COUNT(*) n FROM local_admissions WHERE id=?').get(id).n);
    const entryOf = async id => (await request('/api/office')).data.entries.find(e => e.id === id);
    const refused = 'No se puede volver a despachar este encargo.';

    const retried = await post('/api/office', { action: 'create', kind: 'request', project: P1, role: 'radar', title: 'Synthetic blocked retry', body: 'Synthetic body' });
    assert.equal(retried.status, 200); const retryId = retried.data.id;
    force(retryId, 'blocked', 'Synthetic block reason');
    assert.equal((await post('/api/office', { action: 'update', id: retryId, status: 'queued', result: 'Owner override' })).status, 200);
    const requeued = await entryOf(retryId);
    assert.equal(requeued.status, 'queued'); assert.equal(requeued.result, 'Synthetic block reason');
    assert.equal(admissions(retryId), 1);
    assert.equal((await post('/api/office', { action: 'update', id: retryId, status: 'cancelled' })).status, 200);

    const cancelled = await post('/api/office', { action: 'create', kind: 'request', project: P1, role: 'radar', title: 'Synthetic blocked cancel', body: 'Synthetic body' });
    assert.equal(cancelled.status, 200); const cancelId = cancelled.data.id;
    force(cancelId, 'blocked', 'Synthetic block reason');
    assert.equal((await post('/api/office', { action: 'update', id: cancelId, status: 'cancelled' })).status, 200);
    const before = admissions(cancelId);
    const again = await post('/api/office', { action: 'update', id: cancelId, status: 'queued' });
    assert.equal(again.status, 400); assert.equal(again.data.error, refused);
    assert.equal((await entryOf(cancelId)).status, 'cancelled');
    assert.equal(admissions(cancelId), before);

    const other = await post('/api/office', { action: 'create', kind: 'request', project: P1, role: 'radar', title: 'Synthetic blocked conversation', body: 'Synthetic body' });
    assert.equal(other.status, 200); const otherId = other.data.id;
    force(otherId, 'blocked', 'x', 'conversation');
    const conversation = await post('/api/office', { action: 'update', id: otherId, status: 'queued' });
    assert.equal(conversation.status, 400); assert.equal(conversation.data.error, refused);
    force(otherId, 'cancelled', 'x');
  });

  await check('a blocked request can be retried and is re-admitted', async () => {
    const created = await post('/api/office', { action: 'create', kind: 'request', project: P1, role: 'radar', title: 'Synthetic blocked readmit', body: 'Synthetic body' });
    assert.equal(created.status, 200); const id = created.data.id;
    const db = new DatabaseSync(path.join(directory, 'workspace.sqlite'));
    try { db.prepare("UPDATE entries SET status='blocked',result=? WHERE id=?").run('Synthetic block reason', id); db.prepare('DELETE FROM local_admissions WHERE id=?').run(id); } finally { db.close(); }
    assert.equal((await post('/api/office', { action: 'update', id, status: 'queued' })).status, 200);
    assert.equal((await request('/api/office')).data.entries.find(e => e.id === id).status, 'queued');
    assert.equal(inspect(directory, db => db.prepare('SELECT COUNT(*) n FROM local_admissions WHERE id=?').get(id).n), 1);
    assert.equal((await post('/api/office', { action: 'update', id, status: 'cancelled' })).status, 200);
  });

  await check('setup saves the profile, checks folders and repositories, and keeps the team off without its engine', async () => {
    let r = await request('/api/configurar');
    assert.equal(r.status, 200); assert.equal(r.data.listo, false); assert.equal(r.data.claude.instalado, false); assert.equal(r.data.equipo.instalado, false);
    assert.equal((await request('/api/configurar', { method: 'POST', origin: 'http://evil.test', value: { accion: 'perfil', nombre: 'Ana' } })).status, 403);
    assert.equal((await post('/api/configurar', { accion: 'perfil', nombre: '  ' })).status, 400);
    r = await post('/api/configurar', { accion: 'perfil', nombre: ' Ana ', apodo: 'Anita' });
    assert.equal(r.status, 200); assert.deepEqual(r.data.estado.perfil, { nombre: 'Ana', apodo: 'Anita' });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'perfil', 'perfil.json'), 'utf8')), { nombre: 'Ana', apodo: 'Anita' });
    assert.equal((await request('/api/perfil')).data.nombre, 'Ana');
    assert.equal((await post('/api/configurar', { accion: 'notas', ruta: path.join(runRoot, 'no-existe') })).data.error, 'Esa carpeta no existe.');
    const notas = path.join(runRoot, 'notas-ana'); fs.mkdirSync(notas, { recursive: true });
    r = await post('/api/configurar', { accion: 'notas', ruta: notas });
    assert.equal(r.status, 200); assert.equal(r.data.reiniciar, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'configuracion.json'), 'utf8')).vault, notas);
    assert.equal((await post('/api/configurar', { accion: 'proyecto', nombre: 'Huerto', repo: notas })).data.error, 'Esa carpeta no es un repositorio de git.');
    const repo = path.join(runRoot, 'huerto'); fs.mkdirSync(repo, { recursive: true });
    for (const args of [['init', '-q', '-b', 'main'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x']]) execFileSync('git', ['-C', repo, ...args]);
    r = await post('/api/configurar', { accion: 'proyecto', nombre: 'Huerto Ana', repo, objetivo: 'Primeros clientes' });
    assert.equal(r.status, 200);
    const cfg = JSON.parse(fs.readFileSync(path.join(directory, 'equipo', 'projects.json'), 'utf8'));
    assert.deepEqual(Object.keys(cfg.projects), ['huerto-ana']);
    assert.equal(cfg.projects['huerto-ana'].base, 'main'); assert.equal(cfg.projects['huerto-ana'].board, 'equipo-huerto-ana');
    assert.equal((await post('/api/configurar', { accion: 'proyecto', nombre: 'Huerto Ana', repo })).data.error, 'Ya hay un proyecto con ese nombre.');
    assert.equal((await post('/api/configurar', { accion: 'servicio', activo: true })).data.error, 'El equipo no viene en esta copia.');
    assert.equal((await post('/api/configurar', { accion: 'quitar-proyecto', id: 'huerto-ana' })).status, 200);
    assert.equal((await post('/api/configurar', { accion: 'otra' })).status, 400);
  });

  const previous = { origin: current.origin, cookie: current.cookie, bootstrapToken: current.bootstrapToken };
  await stop(current);
  current = await start(directory);
  await check('restart preserves port and data while rotating authentication', async () => {
    assert.equal(current.origin, previous.origin);
    assert.notEqual(current.bootstrapToken, previous.bootstrapToken);
    assert.equal((await request('/api/office', { cookie: previous.cookie })).status, 401);
    await bootstrap();
    const data = (await request('/api/office')).data;
    assert.equal(data.settings.energy, 'low'); assert.equal(data.settings.focus, P2);
    assert.equal(data.focusSession.note, 'Updated synthetic checkpoint');
    assert.ok(data.entries.some(e => e.id === 'idea-' + captureId));
    assert.ok(data.entries.some(e => e.id === 'chat-' + conversationId));
    assert.equal(data.entries.find(e => e.id === 'chat-' + conversationId).status, 'blocked');
    const recovery = data.messages.filter(m => m.id === conversationId && m.author === 'assistant');
    assert.equal(recovery.length, 1); assert.match(recovery[0].text, /No se ha vuelto a ejecutar/);
    assert.equal(inspect(directory, db => db.prepare('SELECT status FROM entries WHERE id=?').get('imported-active').status), 'dispatching');
    assert.equal(inspect(directory, db => db.prepare('SELECT COUNT(*) n FROM local_metadata').get().n), 1);
    assert.equal(inspect(directory, db => db.prepare("SELECT COUNT(*) n FROM local_admissions WHERE id LIKE 'imported-%'").get().n), 0);
    const duplicate = await post('/api/chat', { id: captureId, text: 'Guarda idea: Synthetic isolated capture.' });
    assert.equal(duplicate.data.duplicate, true);
  });
} catch (error) {
  if (!checks.some(c => !c.passed)) checks.push({ name: 'runtime harness', passed: false, error: error.message });
  process.exitCode = 1;
} finally {
  await Promise.all([...processes].map(child => stop({ child })));
  const summary = {
    serverSha256: fs.existsSync(serverFile) ? createHash('sha256').update(fs.readFileSync(serverFile)).digest('hex') : null,
    passed: checks.filter(c => c.passed).length,
    failed: checks.filter(c => !c.passed).length,
    checks,
  };
  fs.writeFileSync(path.join(runRoot, 'results.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
  console.log(`RESULT ${summary.passed} passed, ${summary.failed} failed. Fixtures and results: ${runRoot}`);
}
