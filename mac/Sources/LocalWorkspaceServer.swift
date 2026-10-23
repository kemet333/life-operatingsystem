import AppKit
import Combine
import Foundation
import Darwin

/// Owns the app's bundled runtime. It never launches an agent or an external browser.
/// READY is consumed through a private pipe; no origin, port or secret is logged.
@MainActor
final class LocalWorkspaceServer: ObservableObject {
    enum State: Equatable { case stopped, starting, ready, failed }
    static let restartCode: Int32 = 75
    @Published private(set) var state: State = .stopped
    @Published private(set) var errorMessage: String?
    private(set) var origin: URL?
    private(set) var dataDirectory: URL?
    var onReady: (() -> Void)?
    var onFailure: ((String) -> Void)?

    private let bundle: Bundle
    private let suppliedDataDirectory: URL?
    private var child: Process?
    private var input: Pipe?
    private var output: Pipe?
    private var errors: Pipe?
    private var stdoutBuffer = Data()
    private var bootstrapToken: String?
    private var generation = UUID()
    private var timeout: DispatchWorkItem?
    private var quitObserver: NSObjectProtocol?

    init(bundle: Bundle = .main, dataDirectory: URL? = nil) {
        self.bundle = bundle
        suppliedDataDirectory = dataDirectory
        quitObserver = NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification,
                                                             object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.stop() }
        }
    }

    deinit {
        if let quitObserver { NotificationCenter.default.removeObserver(quitObserver) }
        output?.fileHandleForReading.readabilityHandler = nil
        errors?.fileHandleForReading.readabilityHandler = nil
        try? input?.fileHandleForWriting.close()
        if child?.isRunning == true { child?.terminate() }
    }

    func start(canonicalWorkspace: URL? = nil) {
        guard state != .starting, state != .ready else { return }
        stopProcess()
        generation = UUID()
        let epoch = generation
        state = .starting
        errorMessage = nil
        guard let resources = bundle.resourceURL else {
            fail("No se han encontrado los recursos de esta app."); return
        }
        let runtime = resources.appendingPathComponent("runtime/node")
        let workspace = resources.appendingPathComponent("workspace", isDirectory: true)
        let server = workspace.appendingPathComponent("server.mjs")
        let manager = FileManager.default
        guard manager.isExecutableFile(atPath: runtime.path) else {
            fail("Falta el motor local en esta instalación. Revisa la copia de la app."); return
        }
        guard manager.fileExists(atPath: server.path) else {
            fail("Faltan los archivos del espacio local en esta instalación."); return
        }
        do {
            let support = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                          appropriateFor: nil, create: true)
            let folder = suppliedDataDirectory ?? support
                .appendingPathComponent("com.lifeoperatingsystem.app", isDirectory: true)
                .appendingPathComponent("Workspace", isDirectory: true)
            guard folder.isFileURL else { fail("La carpeta local de datos no es válida."); return }
            try manager.createDirectory(at: folder, withIntermediateDirectories: true,
                                        attributes: [.posixPermissions: 0o700])
            dataDirectory = folder
        } catch {
            fail("No se ha podido preparar la carpeta de datos de la app."); return
        }

        let process = Process(), stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
        process.executableURL = runtime
        process.arguments = [server.path]
        process.currentDirectoryURL = workspace
        // Do not inherit NODE_OPTIONS, NODE_PATH or credential-bearing environment
        // variables from a terminal that may have launched this application.
        let homeDirectory = manager.homeDirectoryForCurrentUser
        let runtimePath = resources.appendingPathComponent("runtime", isDirectory: true).path
        var environment = ["NODE_ENV": "production", "LIFE_OS_DATA_DIR": dataDirectory!.path,
                           "HOME": homeDirectory.path, "USER": NSUserName(),
                           "TMPDIR": NSTemporaryDirectory(),
                           "PATH": [runtimePath, homeDirectory.appendingPathComponent(".local/bin").path,
                                    "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].joined(separator: ":")]
        if let canonicalWorkspace, canonicalWorkspace.isFileURL {
            environment["LIFE_OS_CANONICAL_WORKSPACE"] = canonicalWorkspace.standardizedFileURL.path
        }
        process.environment = environment
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = stderr
        input = stdin; output = stdout; errors = stderr; child = process
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let bytes = handle.availableData
            if bytes.isEmpty { handle.readabilityHandler = nil }
            DispatchQueue.main.async { self?.consume(bytes, epoch: epoch) }
        }
        // Drain stderr to prevent a blocked child, but never retain or print it.
        stderr.fileHandleForReading.readabilityHandler = { handle in
            if handle.availableData.isEmpty { handle.readabilityHandler = nil }
        }
        process.terminationHandler = { [weak self] finished in
            let status = finished.terminationStatus
            DispatchQueue.main.async {
                guard let self, self.generation == epoch else { return }
                // 75: the server asked to start again (a new configuracion.json from the setup screen).
                if status == Self.restartCode {
                    self.stopProcess(); self.state = .stopped; self.start(); return
                }
                self.fail("El espacio local se ha detenido. Puedes volver a iniciarlo.")
            }
        }
        do { try process.run() }
        catch { fail("No se ha podido iniciar el espacio local de esta app."); return }
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.generation == epoch, self.state == .starting else { return }
            self.fail("El espacio local no ha terminado de arrancar. Puedes volver a intentarlo.")
        }
        timeout = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 12, execute: work)
    }

    /// Only the first WK load needs this header. The server sets a per-launch
    /// HttpOnly session cookie; the token never appears in a URL or persistent data.
    func startupRequest(view: String = "now") -> URLRequest? {
        guard state == .ready, let origin, let bootstrapToken else { return nil }
        let permitted = ["now", "map", "projects", "activity", "memory", "trends"]
        var components = URLComponents(url: origin, resolvingAgainstBaseURL: false)!
        components.path = "/"
        components.queryItems = [URLQueryItem(name: "native", value: "1"),
                                 URLQueryItem(name: "view", value: permitted.contains(view) ? view : "now")]
        var request = URLRequest(url: components.url!, cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: 15)
        request.setValue(bootstrapToken, forHTTPHeaderField: "X-Life-Launch")
        return request
    }

    func stop() {
        generation = UUID()
        stopProcess()
        state = .stopped
        errorMessage = nil
    }

    private func consume(_ bytes: Data, epoch: UUID) {
        guard epoch == generation, state == .starting else { return }
        guard !bytes.isEmpty else { return }
        guard stdoutBuffer.count + bytes.count <= 8_192 else {
            fail("El arranque del espacio local no ha devuelto una respuesta válida."); return
        }
        stdoutBuffer.append(bytes)
        guard let newline = stdoutBuffer.firstIndex(of: 0x0A) else { return }
        let line = stdoutBuffer.prefix(upTo: newline)
        guard let text = String(data: line, encoding: .utf8), text.hasPrefix("READY "),
              let json = String(text.dropFirst(6)).data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: json) as? [String: Any],
              let originText = value["origin"] as? String,
              let token = value["bootstrapToken"] as? String,
              let url = URL(string: originText), url.scheme == "http", url.host == "127.0.0.1",
              let port = url.port, (1...65_535).contains(port), url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil, ["", "/"].contains(url.path),
              (32...256).contains(token.utf8.count),
              token.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) ||
                                    (48...57).contains($0) || $0 == 45 || $0 == 95 }) else {
            fail("El arranque del espacio local no ha devuelto una respuesta válida."); return
        }
        timeout?.cancel(); timeout = nil
        stdoutBuffer.removeAll(keepingCapacity: false)
        origin = url
        bootstrapToken = token
        state = .ready
        onReady?()
    }

    private func fail(_ message: String) {
        generation = UUID()
        stopProcess()
        state = .failed
        errorMessage = message
        onFailure?(message)
    }

    private func stopProcess() {
        timeout?.cancel(); timeout = nil
        origin = nil; bootstrapToken = nil
        stdoutBuffer.removeAll(keepingCapacity: false)
        output?.fileHandleForReading.readabilityHandler = nil
        errors?.fileHandleForReading.readabilityHandler = nil
        try? input?.fileHandleForWriting.close()
        if let child, child.isRunning {
            child.terminationHandler = nil
            child.terminate()
            // Never block the UI waiting for exit. Only this exact child can be
            // killed if it ignores graceful termination while the app is alive.
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 5) {
                if child.isRunning { Darwin.kill(child.processIdentifier, SIGKILL) }
            }
        }
        try? output?.fileHandleForReading.close()
        try? errors?.fileHandleForReading.close()
        input = nil; output = nil; errors = nil; child = nil
    }
}
