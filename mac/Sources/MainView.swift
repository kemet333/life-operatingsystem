import AppKit
import SwiftUI
import WebKit

enum NativeTheme {
    static let background = Color(red: 9/255, green: 10/255, blue: 12/255)
    static let surface = Color(red: 18/255, green: 20/255, blue: 24/255)
    static let inset = Color(red: 12/255, green: 14/255, blue: 17/255)
    static let accent = Color(red: 149/255, green: 187/255, blue: 237/255)
    static let hairline = Color.white.opacity(0.075)
    static let appName = "life.operatingsystem"
}

/// Static identity mark. Its appearance never implies that an agent or microphone is active.
struct AlfredOrb: View {
    var size: CGFloat = 38
    var body: some View {
        ZStack {
            Circle().fill(NativeTheme.accent.opacity(0.07)).blur(radius: size * 0.12)
                .padding(size * 0.04)
            Circle()
                .fill(RadialGradient(colors: [Color(red: 0.85, green: 0.87, blue: 0.91),
                                             Color(red: 0.46, green: 0.49, blue: 0.54),
                                             Color(red: 0.16, green: 0.19, blue: 0.23),
                                             Color(red: 0.07, green: 0.085, blue: 0.105)],
                                     center: .init(x: 0.28, y: 0.22), startRadius: 0,
                                     endRadius: size * 0.73))
                .overlay(Circle().strokeBorder(.white.opacity(0.18), lineWidth: 0.5))
                .padding(size * 0.13)
            Ellipse().stroke(.white.opacity(0.16), lineWidth: 0.5)
                .frame(width: size * 0.78, height: size * 0.28).rotationEffect(.degrees(-24))
            Circle().fill(NativeTheme.accent).frame(width: size * 0.065, height: size * 0.065)
                .offset(x: size * 0.29, y: size * 0.19)
        }.frame(width: size, height: size).accessibilityHidden(true)
    }
}

/// Translucent glass behind the whole window (the owner, 15/10/2026): the desktop shows through, blurred and darkened by the
/// page's own tint, like a native macOS window. The window itself must be non-opaque for it to show.
struct WindowGlass: NSViewRepresentable {
    final class GlassView: NSVisualEffectView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard let window else { return }
            window.isOpaque = false
            window.backgroundColor = .clear
            // A non-opaque window lets the mouse fall through its transparent areas unless told otherwise: the page then
            // never sees the cursor and the orb stops reacting to it. Keep every mouse event, moves included.
            window.ignoresMouseEvents = false
            window.acceptsMouseMovedEvents = true
            // The title bar is part of the same glass: no title text, no separator line. SwiftUI sets the title after the
            // view joins the window, so hide it on the next turn of the run loop too.
            window.titleVisibility = .hidden
            window.titlebarSeparatorStyle = .none
            DispatchQueue.main.async { window.titleVisibility = .hidden; window.titlebarSeparatorStyle = .none }
        }
    }
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = GlassView()
        view.material = .underWindowBackground
        view.blendingMode = .behindWindow
        view.state = .active
        view.appearance = NSAppearance(named: .darkAqua)
        // The smoked tint lives here, under the title bar and the page alike, so the whole window is one surface.
        // The page paints no base colour of its own in the Mac app (coherence.css).
        let tint = NSView()
        tint.wantsLayer = true
        tint.layer?.backgroundColor = NSColor(calibratedRed: 8/255, green: 9/255, blue: 12/255, alpha: 0.5).cgColor
        tint.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(tint)
        NSLayoutConstraint.activate([tint.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                                     tint.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                                     tint.topAnchor.constraint(equalTo: view.topAnchor),
                                     tint.bottomAnchor.constraint(equalTo: view.bottomAnchor)])
        return view
    }
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}

struct RetainedWorkspaceView: NSViewRepresentable {
    @ObservedObject var workspace: NativeWorkspace
    func makeNSView(context: Context) -> WKWebView { workspace.webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {
        let blocked = workspace.blocksWorkspace
        nsView.isHidden = blocked
        if blocked, let responder = nsView.window?.firstResponder as? NSView,
           responder === nsView || responder.isDescendant(of: nsView) {
            nsView.window?.makeFirstResponder(nil)
        }
    }
}

struct MainView: View {
    @ObservedObject var workspace: NativeWorkspace
    @ObservedObject var ritual: RitualController
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings
    @State private var showsStorageInfo = false

    var body: some View {
        ZStack {
            // Clear: the window glass (WindowGlass) shows through; the page paints its own dark tint on top.
            Color.clear
            RetainedWorkspaceView(workspace: workspace)
                .allowsHitTesting(!workspace.blocksWorkspace)
                .accessibilityHidden(workspace.blocksWorkspace)
            if let error = workspace.lastError {
                ConnectionRecoveryView(error: error, retry: workspace.loadInitial)
            }
        }
        .overlay(alignment: .top) {
            if workspace.isLoading {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.mini)
                    Text("Abriendo tu espacio en este Mac").font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }.padding(.horizontal, 13).padding(.vertical, 8)
                    .background(NativeTheme.surface, in: Capsule())
                    .overlay(Capsule().strokeBorder(NativeTheme.hairline, lineWidth: 1))
                    .padding(.top, 15)
            }
        }
        .overlay(alignment: .bottom) {
            if let message = workspace.browserMessage {
                Text(message).font(.system(size: 11)).foregroundStyle(.secondary)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(NativeTheme.surface, in: RoundedRectangle(cornerRadius: 12))
                    .padding(16)
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { showsStorageInfo.toggle() } label: {
                    Label("En este Mac", systemImage: "internaldrive")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
                .help("Este espacio guarda tus datos localmente en este Mac")
                .popover(isPresented: $showsStorageInfo) {
                    VStack(alignment: .leading, spacing: 9) {
                        Text("Tu espacio está en este Mac").font(.system(size: 13, weight: .medium))
                        Text("Los proyectos, encargos y memoria se guardan en la carpeta de datos de esta app. La copia web tiene su propia sesión y datos.")
                            .font(.system(size: 12)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }.padding(20).frame(width: 295)
                        .background(NativeTheme.surface).preferredColorScheme(.dark)
                }
                if ritual.captureRunning {
                    Button { openSettings() } label: {
                        Image(systemName: "mic.fill").foregroundStyle(NativeTheme.accent)
                    }.help("Escucha del ritual activa · abrir ajustes")
                        .accessibilityLabel("Micrófono activo. Abrir ajustes del ritual")
                }
                Button { openSettings() } label: { Image(systemName: "gearshape") }
                    .help("Ritual de inicio y ajustes")
                    .accessibilityLabel("Abrir ajustes y ritual de inicio")
                Menu {
                    Button("Recargar espacio") { workspace.reload() }
                        .keyboardShortcut("r", modifiers: .command)
                    Button("Abrir copia web") { workspace.openInBrowser() }
                    if ritual.wantsListening || ritual.isPlaying {
                        Divider()
                        Button("Detener ritual y micrófono") { ritual.stopEverything() }
                    }
                } label: { Image(systemName: "ellipsis.circle") }
                    .help("Opciones del espacio")
            }
        }
        .background(WindowGlass().ignoresSafeArea())
        // One surface: the title bar sits on the same glass, without its own band or a repeated title.
        .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
        .toolbar(removing: .title)
        .preferredColorScheme(.dark)
        .tint(NativeTheme.accent)
        .onAppear {
            workspace.connectSpeech(to: ritual)
            ritual.showMainWindow = {
                openWindow(id: "main")
                NSApp.activate(ignoringOtherApps: true)
                NSApp.windows.first { $0.title == NativeTheme.appName }?.makeKeyAndOrderFront(nil)
            }
            AppDelegate.shared?.showWindow = ritual.showMainWindow
            AppDelegate.shared?.shutdown = { ritual.stopEverything(); workspace.stop() }
        }
    }
}

private struct ConnectionRecoveryView: View {
    let error: String
    let retry: () -> Void
    var body: some View {
        VStack(spacing: 0) {
            AlfredOrb(size: 72).padding(.bottom, 23)
            Text("Tu espacio no pudo abrirse").font(.system(size: 24, weight: .semibold)).tracking(-0.5)
                .padding(.bottom, 10)
            Text("Vuelve a intentarlo. El ritual y los ajustes siguen disponibles en la app.")
                .font(.system(size: 13)).foregroundStyle(.secondary)
                .multilineTextAlignment(.center).frame(maxWidth: 350)
            Button("Reintentar", action: retry).buttonStyle(.borderedProminent)
                .tint(.white).foregroundStyle(.black)
                .controlSize(.large).padding(.top, 25)
            DisclosureGroup("Detalles") {
                Text(error).font(.system(size: 11)).foregroundStyle(.secondary)
                    .textSelection(.enabled).padding(.top, 9)
            }.font(.system(size: 11)).foregroundStyle(.secondary)
                .frame(maxWidth: 390).padding(.top, 31)
        }.padding(45).frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(NativeTheme.background)
    }
}

private struct SettingsSection<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
                .padding(.leading, 3)
            VStack(spacing: 0) { content }
                .background(NativeTheme.surface, in: RoundedRectangle(cornerRadius: 13))
                .overlay(RoundedRectangle(cornerRadius: 13)
                    .strokeBorder(NativeTheme.hairline, lineWidth: 0.75))
        }
    }
}

private struct SettingsSymbol: View {
    let name: String
    var body: some View {
        Image(systemName: name).font(.system(size: 13, weight: .medium))
            .foregroundStyle(NativeTheme.accent)
            .frame(width: 30, height: 30)
            .background(NativeTheme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }
}

struct RitualSettingsView: View {
    @ObservedObject var ritual: RitualController
    private var hasTrack: Bool { ritual.trackName != "Ninguna pista seleccionada" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 27) {
                header
                activation
                music
                voice
                greeting
                Text("Solo funciona con la app abierta y la escucha activada. No se configura inicio automático.")
                    .font(.system(size: 11)).foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, -8)
            }.padding(.horizontal, 35).padding(.top, 34).padding(.bottom, 32)
                .frame(maxWidth: 705, alignment: .leading).frame(maxWidth: .infinity)
        }
        .background(NativeTheme.background)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            actions.padding(.horizontal, 35).padding(.vertical, 20)
                .frame(maxWidth: 705).frame(maxWidth: .infinity)
                .background(NativeTheme.background)
                .overlay(alignment: .top) { Rectangle().fill(NativeTheme.hairline).frame(height: 0.5) }
        }
        .preferredColorScheme(.dark)
        .tint(NativeTheme.accent)
        .onAppear { ritual.refreshVoices() }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 16) {
            AlfredOrb(size: 55)
            VStack(alignment: .leading, spacing: 8) {
                Text("Ritual de inicio").font(.system(size: 27, weight: .semibold)).tracking(-0.65)
                Text("Dos chasquidos para traer a Alfred. Tu pista, tu saludo, tu comienzo.")
                    .font(.system(size: 13)).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }.padding(.top, 4)
            Spacer(minLength: 0)
        }.padding(.bottom, 3)
    }

    private var activation: some View {
        SettingsSection(title: "Activación") {
            HStack(spacing: 13) {
                SettingsSymbol(name: "hands.clap")
                VStack(alignment: .leading, spacing: 5) {
                    Text("Escuchar dos chasquidos").font(.system(size: 13, weight: .medium))
                    Text("Si lo dejas encendido, sigue encendido al volver a abrir la app.")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
                Spacer(minLength: 14)
                Toggle("Escuchar dos chasquidos", isOn: Binding(get: { ritual.wantsListening },
                                                             set: { ritual.setListening($0) }))
                    .labelsHidden().toggleStyle(.switch).controlSize(.small)
            }.padding(18)
            sectionDivider
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 7) {
                    Circle().fill(ritual.captureRunning ? NativeTheme.accent : Color.white.opacity(0.25))
                        .frame(width: 5, height: 5)
                    Text(ritual.status).font(.system(size: 11, weight: .medium))
                }.foregroundStyle(ritual.captureRunning ? NativeTheme.accent : Color.secondary)
                Text(ritual.detail).font(.system(size: 11)).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if ritual.status.contains("permiso") {
                    Button("Abrir ajustes de micrófono") { ritual.openMicrophoneSettings() }
                        .font(.system(size: 11)).buttonStyle(.link).padding(.top, 3)
                }
            }.padding(.horizontal, 18).padding(.vertical, 14)
        }
    }

    private var music: some View {
        SettingsSection(title: "Sonido") {
            HStack(spacing: 13) {
                SettingsSymbol(name: "music.note")
                VStack(alignment: .leading, spacing: 5) {
                    Text(hasTrack ? ritual.trackName : "Elige tu pista")
                        .font(.system(size: 13, weight: .medium)).lineLimit(2)
                    Text("Un archivo de audio de este Mac.")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
                Spacer(minLength: 12)
                Button(hasTrack ? "Cambiar…" : "Elegir…") { ritual.chooseTrack() }
                    .controlSize(.small).buttonStyle(.bordered)
                if hasTrack {
                    Menu {
                        Button("Quitar pista", role: .destructive) { ritual.removeTrack() }
                    } label: { Image(systemName: "ellipsis") }
                    .menuStyle(.borderlessButton).fixedSize().frame(width: 15)
                    .help("Opciones de la pista")
                }
            }.padding(18)
            sectionDivider
            volumeRow("Música", symbol: "speaker.wave.2", value: $ritual.musicVolume, range: 0...0.7)
            sectionDivider
            volumeRow("Voz de Alfred", symbol: "waveform", value: $ritual.voiceVolume, range: 0.1...0.8)
        }
    }

    private var greeting: some View {
        SettingsSection(title: "Saludo de Alfred") {
            VStack(alignment: .leading, spacing: 13) {
                TextEditor(text: $ritual.greeting)
                    .font(.system(size: 14)).lineSpacing(5)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 85, maxHeight: 115)
                    .padding(11)
                    .background(NativeTheme.inset, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(NativeTheme.hairline, lineWidth: 0.5))
                    .accessibilityLabel("Frase que dice Alfred")
                HStack {
                    Label("La voz elegida para Alfred", systemImage: "waveform")
                        .font(.system(size: 10.5)).foregroundStyle(.secondary)
                    Spacer()
                    Button("Restaurar frase") { ritual.restoreGreeting() }
                        .font(.system(size: 10.5)).buttonStyle(.link)
                }
            }.padding(16)
        }
    }

    private var voice: some View {
        SettingsSection(title: "Voz de Alfred") {
            VStack(alignment: .leading, spacing: 13) {
                Picker("Voz local", selection: $ritual.voiceIdentifier) {
                    Text("Elegir voz…").tag("")
                    if !ritual.voiceIdentifier.isEmpty && !ritual.availableVoices.contains(where: { $0.id == ritual.voiceIdentifier }) {
                        Text("Voz elegida no disponible").tag(ritual.voiceIdentifier)
                    }
                    ForEach(ritual.availableVoices) { option in
                        Text(option.label).tag(option.id)
                    }
                }.pickerStyle(.menu).font(.system(size: 12))
                Text(ritual.voiceHelp).font(.system(size: 11)).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 16) {
                    Button("Actualizar voces") { ritual.refreshVoices() }.buttonStyle(.link)
                    Button("Gestionar voces en macOS") { ritual.openVoiceSettings() }.buttonStyle(.link)
                }.font(.system(size: 11))
            }.padding(18)
        }
    }

    private var actions: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Button { ritual.testRitual() } label: { Label("Probar ritual", systemImage: "play.fill") }
                    .buttonStyle(.borderedProminent)
                    .tint(.white).foregroundStyle(.black)
                Button("Solo el saludo") { ritual.testGreeting() }.buttonStyle(.bordered)
                Spacer(minLength: 10)
                Button("Detener todo", role: .destructive) { ritual.stopEverything() }
                    .buttonStyle(.bordered).keyboardShortcut(".", modifiers: .command)
            }.controlSize(.large)
            Label("Audio local. El micrófono se detiene durante música y voz; no se guarda ni se sube.",
                  systemImage: "lock.fill")
                .font(.system(size: 10.5)).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var sectionDivider: some View {
        Rectangle().fill(NativeTheme.hairline).frame(height: 0.5).padding(.leading, 18)
    }

    private func volumeRow(_ title: String, symbol: String, value: Binding<Double>, range: ClosedRange<Double>) -> some View {
        HStack(spacing: 13) {
            Image(systemName: symbol).font(.system(size: 12)).foregroundStyle(.secondary).frame(width: 30)
            Text(title).font(.system(size: 12)).frame(width: 94, alignment: .leading)
            Slider(value: value, in: range).controlSize(.small)
            Text("\(Int(value.wrappedValue * 100)) %").font(.system(size: 11)).monospacedDigit()
                .foregroundStyle(.secondary).frame(width: 42, alignment: .trailing)
        }.padding(.horizontal, 18).padding(.vertical, 15)
    }
}
