#!/bin/zsh
set -euo pipefail
project_dir="${0:A:h}"
test_dir="${LIFE_OS_TEST_DIR:-${TMPDIR:-/private/tmp}/life-os-tests-$UID}"
mkdir -p "$test_dir/modules"
xcrun swiftc -swift-version 6 -strict-concurrency=complete -module-cache-path "$test_dir/modules" \
  "$project_dir/Sources/DoubleClapDetector.swift" "$project_dir/Tests/DetectorChecks.swift" \
  -o "$test_dir/detector-checks"
"$test_dir/detector-checks"
xcrun swiftc -swift-version 6 -strict-concurrency=complete -module-cache-path "$test_dir/modules" \
  "$project_dir/Sources/DoubleClapDetector.swift" "$project_dir/Sources/AudioWindowFeatures.swift" \
  "$project_dir/Tests/FeatureChecks.swift" -framework AVFoundation -o "$test_dir/feature-checks"
"$test_dir/feature-checks"

xcrun swiftc -swift-version 6 -strict-concurrency=complete -module-cache-path "$test_dir/modules" \
  "$project_dir/Sources/NativeSpeechRequest.swift" "$project_dir/Tests/NativeSpeechChecks.swift" \
  -o "$test_dir/native-speech-checks"
"$test_dir/native-speech-checks"

node_binary="${LIFE_OS_NODE_BINARY:-$(command -v node || echo "$HOME/.local/bin/node")}"; node_binary=${node_binary:A}
"$node_binary" "$project_dir/local-workspace/build-server.mjs"
"$node_binary" "$project_dir/local-workspace/runtime-checks.mjs"
"$node_binary" "$project_dir/local-workspace/telegram-checks.mjs"
"$node_binary" "$project_dir/local-workspace/cartera-checks.mjs"
"$node_binary" "$project_dir/local-workspace/contenido-checks.mjs"
"$node_binary" "$project_dir/local-workspace/voice-checks.mjs"
