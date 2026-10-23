// alfred-calendario: a tiny command-line helper inside the app bundle that lets the local server read today's events
// and keep the day's to-do in a Reminders list (which syncs to the iPhone). It runs as a child of the app, so macOS asks
// for Calendars and Reminders access once, under the app's name. Output is always one line of JSON.
//   permiso                          → {"eventos":"concedido|denegado","recordatorios":"…"}
//   eventos <yyyy-mm-dd>             → [{"titulo","inicio","fin","todoElDia","calendario"}]
//   recordatorios <lista>            → [{"id","titulo","hecho","vence"}]   (open ones, plus those completed today)
//   crear <lista> <titulo> <fecha>   → {"id"}                              (creates the list if it does not exist)
//   completar <id> <1|0>             → {"ok":true}
import EventKit
import Foundation

let store = EKEventStore()
func out(_ value: Any) {
    let data = (try? JSONSerialization.data(withJSONObject: value, options: [])) ?? Data("{}".utf8)
    FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data("\n".utf8))
}
func fail(_ message: String) -> Never { out(["error": message]); exit(1) }
func wait(_ body: (@escaping (Bool) -> Void) -> Void) -> Bool {
    let done = DispatchSemaphore(value: 0); var granted = false
    body { ok in granted = ok; done.signal() }
    _ = done.wait(timeout: .now() + 120)
    return granted
}
func access(_ type: EKEntityType) -> Bool {
    let status = EKEventStore.authorizationStatus(for: type)
    if status == .fullAccess { return true }
    if status == .denied || status == .restricted { return false }
    return wait { finish in
        if type == .event { store.requestFullAccessToEvents { ok, _ in finish(ok) } }
        else { store.requestFullAccessToReminders { ok, _ in finish(ok) } }
    }
}
let dayFormat: DateFormatter = { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); return f }()
let isoFormat = ISO8601DateFormatter()
func day(_ text: String) -> Date { guard let d = dayFormat.date(from: text) else { fail("fecha no válida") }; return d }
func list(named name: String, create: Bool) -> EKCalendar? {
    if let found = store.calendars(for: .reminder).first(where: { $0.title == name }) { return found }
    guard create else { return nil }
    let cal = EKCalendar(for: .reminder, eventStore: store)
    cal.title = name
    guard let source = store.defaultCalendarForNewReminders()?.source ?? store.sources.first(where: { $0.sourceType == .calDAV || $0.sourceType == .local }) else { fail("no hay dónde crear la lista") }
    cal.source = source
    do { try store.saveCalendar(cal, commit: true) } catch { fail("no se ha podido crear la lista") }
    return cal
}

let args = Array(CommandLine.arguments.dropFirst())
switch args.first ?? "" {
case "permiso":
    out(["eventos": access(.event) ? "concedido" : "denegado", "recordatorios": access(.reminder) ? "concedido" : "denegado"])
case "eventos":
    guard args.count == 2 else { fail("uso: eventos <fecha>") }
    guard access(.event) else { fail("sin permiso para el calendario") }
    let start = Calendar.current.startOfDay(for: day(args[1])), end = Calendar.current.date(byAdding: .day, value: 1, to: start)!
    let events = store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: nil))
        .sorted { $0.startDate < $1.startDate }
        .map { ["titulo": $0.title ?? "", "inicio": isoFormat.string(from: $0.startDate), "fin": isoFormat.string(from: $0.endDate), "todoElDia": $0.isAllDay, "calendario": $0.calendar.title] as [String: Any] }
    out(events)
case "recordatorios":
    guard args.count == 2 else { fail("uso: recordatorios <lista>") }
    guard access(.reminder) else { fail("sin permiso para recordatorios") }
    guard let cal = list(named: args[1], create: false) else { out([]); break }
    let today = Calendar.current.startOfDay(for: Date())
    let found = wait { finish in
        _ = store.fetchReminders(matching: store.predicateForReminders(in: [cal])) { items in
            let rows = (items ?? []).filter { !$0.isCompleted || ($0.completionDate ?? .distantPast) >= today }.map { r -> [String: Any] in
                var row: [String: Any] = ["id": r.calendarItemIdentifier, "titulo": r.title ?? "", "hecho": r.isCompleted]
                if let due = r.dueDateComponents, let d = Calendar.current.date(from: due) { row["vence"] = dayFormat.string(from: d) }
                return row
            }
            out(rows); finish(true)
        }
    }
    if !found { fail("no se han podido leer los recordatorios") }
case "crear":
    guard args.count == 4 else { fail("uso: crear <lista> <titulo> <fecha>") }
    guard access(.reminder) else { fail("sin permiso para recordatorios") }
    guard let cal = list(named: args[1], create: true) else { fail("sin lista") }
    let r = EKReminder(eventStore: store)
    r.calendar = cal; r.title = args[2]
    r.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day], from: day(args[3]))
    do { try store.save(r, commit: true); out(["id": r.calendarItemIdentifier]) } catch { fail("no se ha podido crear") }
case "completar":
    guard args.count == 3 else { fail("uso: completar <id> <1|0>") }
    guard access(.reminder) else { fail("sin permiso para recordatorios") }
    guard let r = store.calendarItem(withIdentifier: args[1]) as? EKReminder else { fail("no existe") }
    r.isCompleted = args[2] == "1"
    do { try store.save(r, commit: true); out(["ok": true]) } catch { fail("no se ha podido guardar") }
default:
    fail("orden desconocida")
}
