$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$proof = Join-Path $PWD 'startup-proof'
New-Item -ItemType Directory -Force $proof | Out-Null
$installer = Join-Path $env:RUNNER_TEMP 'life-Windows-v0.6.1.exe'
$install = Join-Path $env:RUNNER_TEMP 'life-startup-install'
$data = Join-Path $env:RUNNER_TEMP 'life-startup-data'
$expected = '346bba0ea0544694de2f8cf91b7e61ed456252cc606265383195d1fb95a9e53c'
$socket = $null

function Cdp($method, $params) {
  $request = @{id=1;method=$method;params=$params} | ConvertTo-Json -Depth 12 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($request)
  $socket.SendAsync([ArraySegment[byte]]::new($bytes), [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
  do {
    $stream = [IO.MemoryStream]::new()
    do {
      $buffer = [byte[]]::new(65536)
      $frame = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
      if ($frame.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) { throw 'Debugger closed before verification' }
      $stream.Write($buffer, 0, $frame.Count)
    } until ($frame.EndOfMessage)
    $reply = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
    $stream.Dispose()
  } until ($reply.id -eq 1)
  if ($reply.error) { throw "CDP failed: $($reply.error.message)" }
  return $reply.result
}

try {
  Invoke-WebRequest 'https://github.com/kemet333/life-operatingsystem/releases/download/v0.6.1/life.operatingsystem-Windows.exe' -OutFile $installer
  $actual = (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw 'Published installer hash mismatch' }
  $setup = Start-Process $installer -ArgumentList "/S /D=$install" -PassThru
  if (!$setup.WaitForExit(120000)) { throw 'Installer timed out' }
  if ($setup.ExitCode -ne 0) { throw "Installer exit $($setup.ExitCode)" }
  $exe = Join-Path $install 'Life Operating System.exe'
  if (!(Test-Path $exe)) { throw 'Installed executable not found' }
  # Only stop processes created inside this test's installation, if NSIS launched it automatically.
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($install) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $env:LIFE_OS_DATA_DIR = $data
  Start-Process $exe -ArgumentList '--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --force-renderer-accessibility' | Out-Null
  $deadline = (Get-Date).AddSeconds(90)
  $target = $null
  do {
    try { $target = Invoke-RestMethod 'http://127.0.0.1:9222/json' | Where-Object { $_.type -eq 'page' -and $_.url -like 'http://127.0.0.1:*' } | Select-Object -First 1 } catch {}
    if (!$target) { Start-Sleep -Seconds 1 }
  } until ($target -or (Get-Date) -gt $deadline)
  if (!$target) { throw 'Desktop did not open its authenticated local page' }
  $socket = [Net.WebSockets.ClientWebSocket]::new()
  $socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
  do {
    $result = Cdp 'Runtime.evaluate' @{expression='JSON.stringify({title:document.title,text:document.body.innerText,url:location.href})';returnByValue=$true}
    $page = $result.result.value | ConvertFrom-Json
    if ($page.text -notmatch 'nombre|name') { Start-Sleep -Seconds 1 }
  } until ($page.text -match 'nombre|name' -or (Get-Date) -gt $deadline)
  $shot = Cdp 'Page.captureScreenshot' @{format='png'}
  [IO.File]::WriteAllBytes((Join-Path $proof 'onboarding.png'), [Convert]::FromBase64String($shot.data))
  $page | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $proof 'page.json')
  if ($page.text -notmatch 'nombre|name') { throw 'Fresh onboarding name screen was not reached; inspect page.json and onboarding.png' }
  @{release='v0.6.1';installerSha256=$actual;installed=$true;localPage=$true;onboarding=$true;aiLogin=$false;humanPilot=$false;os=[Environment]::OSVersion.VersionString;text=$page.text} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $proof 'result.json')
  Write-Host 'Published Windows installer reached first-launch onboarding. No AI login or external message.'
} finally {
  if ($socket) { $socket.Dispose() }
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($install) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
