import AppKit
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    static weak var shared: AppDelegate?
    var showWindow: (() -> Void)?
    var shutdown: (() -> Void)?
    override init() { super.init(); Self.shared = self }
    func applicationDidFinishLaunching(_ notification: Notification) {
        Self.shared = self
        // This is the appearance of this application only, never a system preference.
        NSApp.appearance = NSAppearance(named: .darkAqua)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow?()
        return true
    }
    func applicationWillTerminate(_ notification: Notification) { shutdown?() }
}

@main
struct LifeOSApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var ritual = RitualController()
    @StateObject private var workspace = NativeWorkspace()

    var body: some Scene {
        Window("life.operatingsystem", id: "main") {
            MainView(workspace: workspace, ritual: ritual)
                .frame(minWidth: 880, minHeight: 640)
                .preferredColorScheme(.dark)
        }
        // Always open the window at launch: with no window, the local space and the two-snap ritual never connect.
        .defaultLaunchBehavior(.presented)
        .restorationBehavior(.disabled)
        .windowStyle(.hiddenTitleBar)
        .windowToolbarStyle(.unifiedCompact(showsTitle: false))
        .defaultSize(width: 1200, height: 800)
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Detener ritual y micrófono") { ritual.stopEverything() }
                    .keyboardShortcut(".", modifiers: .command)
            }
        }
        Settings {
            RitualSettingsView(ritual: ritual).frame(width: 685, height: 720)
                .preferredColorScheme(.dark)
        }
    }
}
