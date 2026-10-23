#!/bin/zsh
set -euo pipefail
project_dir="${0:A:h}"
build_dir="${LIFE_OS_BUILD_DIR:-${TMPDIR:-/private/tmp}/life-os-build-$UID}"
app_dir="$build_dir/life.operatingsystem.app"
delivery_app_dir="$project_dir/life.operatingsystem.app"
sdk_dir="$(xcrun --show-sdk-path)"
source_dir="$build_dir/sources"
mkdir -p "$source_dir"
cp -X "$project_dir"/Sources/*.swift "$source_dir/"
node_binary="${LIFE_OS_NODE_BINARY:-$(command -v node || echo "$HOME/.local/bin/node")}"; node_binary=${node_binary:A}
node_license="${LIFE_OS_NODE_LICENSE:-${node_binary:h:h}/LICENSE}"
site_dir="$project_dir/../alfred-os"
local_dir="$project_dir/local-workspace"
deps_dir="${LIFE_OS_DEPS_DIR:-$site_dir}"
"$node_binary" "$deps_dir/node_modules/vite/bin/vite.js" build --config "$local_dir/vite.config.ts"
"$node_binary" "$local_dir/build-server.mjs"
# Start from an empty bundle: copying over the previous one kept every old
# hashed asset (25 dead JS/CSS pairs in v0.5.0).
rm -rf "$app_dir"
mkdir -p "$build_dir/modules" "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
mkdir -p "$app_dir/Contents/Resources/runtime" "$app_dir/Contents/Resources/workspace/bridge"
# Keep the signed Node executable unchanged; no credentials or personal database
# are packaged. The one-time import belongs in Application Support only.
cp "$node_binary" "$app_dir/Contents/Resources/runtime/node"
cp "$node_license" "$app_dir/Contents/Resources/runtime/Node-LICENSE"
cp "$local_dir/dist/server.mjs" "$app_dir/Contents/Resources/workspace/"
# The optional bridge with Hermes (absent from the open-source build).
[ -f "$local_dir/local-bridge.py" ] && cp "$local_dir/local-bridge.py" "$app_dir/Contents/Resources/workspace/"
[ -f "$site_dir/integrations/alfred-bridge.py" ] && cp "$site_dir/integrations/alfred-bridge.py" "$app_dir/Contents/Resources/workspace/bridge/"
# The agent team engine travels with the app for new installs (an owner's own checkout, set in configuracion.json, wins).
mkdir -p "$app_dir/Contents/Resources/workspace/equipo"
cp -X "$project_dir/../equipo/"{equipo,tablero,plataforma,servicio}.py "$project_dir/../equipo/"{modelos,departments}.json "$app_dir/Contents/Resources/workspace/equipo/"
mkdir -p "$app_dir/Contents/Resources/workspace/client"
cp -R -X "$local_dir/dist/client/." "$app_dir/Contents/Resources/workspace/client/"
# Alfred's voice brain: the Agent SDK and its signed Claude Code binary, loaded by server.mjs at runtime.
# Credentials are not packaged; the binary uses the Mac's existing Claude login.
agent_sdk="$local_dir/node_modules/@anthropic-ai"
if [ ! -d "$agent_sdk/claude-agent-sdk-darwin-arm64" ]; then (cd "$local_dir" && "${node_binary:h}/npm" ci --no-audit --no-fund); fi
mkdir -p "$app_dir/Contents/Resources/workspace/node_modules/@anthropic-ai"
cp -R -X "$agent_sdk/claude-agent-sdk" "$agent_sdk/claude-agent-sdk-darwin-arm64" "$app_dir/Contents/Resources/workspace/node_modules/@anthropic-ai/"
xcrun swiftc -swift-version 5 -O -target arm64-apple-macosx15.0 -sdk "$sdk_dir" \
  -module-cache-path "$build_dir/modules" -parse-as-library \
  "$source_dir/LifeOSApp.swift" "$source_dir/MainView.swift" \
  "$source_dir/NativeWorkspace.swift" "$source_dir/LocalWorkspaceServer.swift" \
  "$source_dir/RitualController.swift" "$source_dir/NativeSpeechRequest.swift" \
  "$source_dir/DoubleClapDetector.swift" "$source_dir/AudioWindowFeatures.swift" \
  "$source_dir/NativeDictation.swift" \
  -framework SwiftUI -framework AppKit -framework WebKit -framework AVFoundation -framework Speech \
  -o "$app_dir/Contents/MacOS/LifeOperatingSystem"
# Calendar and Reminders helper (today's events, the to-do list in Reminders), run by the local server.
xcrun swiftc -swift-version 5 -O -target arm64-apple-macosx15.0 -sdk "$sdk_dir" -module-cache-path "$build_dir/modules" \
  "$source_dir/CalendarHelper.swift" -framework EventKit -o "$app_dir/Contents/MacOS/alfred-calendario"
xcrun swiftc -swift-version 5 -O -sdk "$sdk_dir" -module-cache-path "$build_dir/modules" \
  "$source_dir/BuildIcon.swift" -framework AppKit -o "$build_dir/build-icon"
"$build_dir/build-icon" "$build_dir/AppIcon.iconset" "$app_dir/Contents/Resources/AppIcon.icns"
cp "$project_dir/Resources/Info.plist" "$app_dir/Contents/Info.plist"
xattr -cr "$app_dir"
# The owner's local certificate, when it exists, keeps one identity across builds: macOS then remembers the
# Documents and microphone permissions instead of asking again after every build. Otherwise ad hoc, as before.
identity="${LIFE_OS_SIGN_IDENTITY:-Life OS Local}"
if security find-identity -p codesigning 2>/dev/null | grep -q "\"$identity\""; then sign_as="$identity"; else sign_as="-"; fi
codesign --force --sign "$sign_as" --options runtime --entitlements "$project_dir/Resources/entitlements.plist" "$app_dir/Contents/MacOS/alfred-calendario"
codesign --force --sign "$sign_as" --options runtime --entitlements "$project_dir/Resources/entitlements.plist" "$app_dir"
codesign --verify --deep --strict "$app_dir"
plutil -lint "$app_dir/Contents/Info.plist"
ditto --norsrc --noextattr -c -k --keepParent "$app_dir" "$project_dir/life-operatingsystem-mac.zip"
rm -rf "$delivery_app_dir"
ditto --norsrc --noextattr "$app_dir" "$delivery_app_dir"
printf 'Compilada y firmada localmente (%s): %s\nCopia archivada sin atributos: %s\n' "$([ "$sign_as" = - ] && echo 'ad hoc' || echo "$sign_as")" "$delivery_app_dir" "$project_dir/life-operatingsystem-mac.zip"
