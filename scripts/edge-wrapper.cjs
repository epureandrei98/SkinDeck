const { spawn } = require('node:child_process');
const { existsSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const http = require('node:http');

const root = join(__dirname, '..');
const port = 5173;
const url = `http://127.0.0.1:${port}`;
const edgeProfileDir = process.env.SKINDECK_EDGE_PROFILE || join(process.env.LOCALAPPDATA || root, 'SkinDeck', 'EdgeProfile');
const windowSize = readArgValue('--size') || process.env.SKINDECK_EDGE_SIZE || '285,384';
const windowPosition = readArgValue('--position') || process.env.SKINDECK_EDGE_POSITION || '80,80';
const [windowWidth, windowHeight] = parsePair(windowSize, [285, 384]);
const [windowX, windowY] = parsePair(windowPosition, [80, 80]);
const normalizedWindowSize = `${windowWidth},${windowHeight}`;
const normalizedWindowPosition = `${windowX},${windowY}`;
const shouldResetProfile = process.argv.includes('--reset-profile') || process.env.SKINDECK_EDGE_RESET_PROFILE === '1';
const shouldHideFrame = process.argv.includes('--frameless') || process.env.SKINDECK_EDGE_FRAMELESS === '1';
const shouldUseKiosk = process.argv.includes('--kiosk') || process.env.SKINDECK_EDGE_KIOSK === '1';

if (shouldResetProfile && existsSync(edgeProfileDir)) {
  rmSync(edgeProfileDir, { recursive: true, force: true });
}

const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const vite = spawn(process.execPath, [viteBin, '--host', '127.0.0.1'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env }
});

waitForServer(url)
  .then(() => {
    const edgePath = findEdgeExecutable();
    const edgeArgs = [
      shouldUseKiosk ? '--kiosk' : '--app=' + url,
      shouldUseKiosk ? url : null,
      '--user-data-dir=' + edgeProfileDir,
      '--window-size=' + normalizedWindowSize,
      '--window-position=' + normalizedWindowPosition,
      '--new-window',
      '--no-first-run'
    ].filter(Boolean);
    const edge = spawn(edgePath, edgeArgs, {
      cwd: root,
      stdio: 'ignore',
      detached: true
    });
    const edgePid = edge.pid;
    edge.unref();
    console.log(`Started SkinDeck Edge wrapper at ${url}`);
    console.log(`Edge profile: ${edgeProfileDir}`);
    console.log(`Edge args: ${edgeArgs.join(' ')}`);
    console.log(`Forcing window bounds after launch: ${normalizedWindowPosition} ${normalizedWindowSize}`);
    if (shouldHideFrame) console.log('Removing native Edge title bar after launch.');
    if (shouldUseKiosk) console.log('Using Edge kiosk mode. Press Alt+F4 to close.');
    resizeEdgeWindow(edgePid);
  })
  .catch((error) => {
    console.error(error);
    vite.kill();
    process.exit(1);
  });

function waitForServer(targetUrl) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(targetUrl, (response) => {
        response.resume();
        resolve();
      });

      request.on('error', () => {
        if (Date.now() - startedAt > 20_000) {
          reject(new Error(`Timed out waiting for Vite at ${targetUrl}`));
          return;
        }
        setTimeout(attempt, 250);
      });
    };

    attempt();
  });
}

function findEdgeExecutable() {
  const candidates = [
    process.env.MSEDGE_PATH,
    join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean);

  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return found;

  return 'msedge.exe';
}

function resizeEdgeWindow(edgePid) {
  if (process.platform !== 'win32') return;

  const width = windowWidth;
  const height = windowHeight;
  const x = windowX;
  const y = windowY;
  const script = [
    'Add-Type -TypeDefinition \'using System; using System.Collections.Generic; using System.Text; using System.Runtime.InteropServices; public static class Win32 { public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam); [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam); [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count); [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId); [DllImport("user32.dll", EntryPoint="GetWindowLongPtr")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex); [DllImport("user32.dll", EntryPoint="SetWindowLongPtr")] public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong); [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags); [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hWnd, int dwAttribute, ref int pvAttribute, int cbAttribute); }\';',
    `$targetPid = ${Number.isFinite(edgePid) ? edgePid : 0};`,
    'function Find-SkinDeckWindows {',
    '  $found = [System.Collections.Generic.List[IntPtr]]::new();',
    '  $callback = [Win32+EnumWindowsProc]{ param([IntPtr]$hWnd, [IntPtr]$lParam)',
    '    if (-not [Win32]::IsWindowVisible($hWnd)) { return $true }',
    '    $className = New-Object System.Text.StringBuilder 256;',
    '    [void][Win32]::GetClassName($hWnd, $className, $className.Capacity);',
    '    if ($className.ToString() -notlike "Chrome_WidgetWin*") { return $true }',
    '    if ($targetPid -gt 0) {',
    '      $pid = 0;',
    '      [void][Win32]::GetWindowThreadProcessId($hWnd, [ref]$pid);',
    '      if ($pid -eq $targetPid) { [void]$script:found.Add($hWnd) }',
    '    }',
    '    $title = New-Object System.Text.StringBuilder 512;',
    '    [void][Win32]::GetWindowText($hWnd, $title, $title.Capacity);',
    '    if ($title.ToString() -like "*SkinDeck*") { [void]$script:found.Add($hWnd) }',
    '    return $true;',
    '  };',
    '  [void][Win32]::EnumWindows($callback, [IntPtr]::Zero);',
    '  return $script:found;',
    '}',
    `$deadline = (Get-Date).AddSeconds(12);`,
    '$applied = $false;',
    'do {',
    '  $windows = Find-SkinDeckWindows;',
    '  foreach ($hWnd in $windows) {',
    shouldHideFrame ? '    $style = [Win32]::GetWindowLongPtr($hWnd, -16).ToInt64();' : '',
    shouldHideFrame ? '    $remove = 0x00C00000 -bor 0x00040000 -bor 0x00080000 -bor 0x00020000 -bor 0x00010000;' : '',
    shouldHideFrame ? '    [void][Win32]::SetWindowLongPtr($hWnd, -16, [IntPtr]($style -band (-bnot $remove)));' : '',
    shouldHideFrame ? '    $ncrpDisabled = 1; [void][Win32]::DwmSetWindowAttribute($hWnd, 2, [ref]$ncrpDisabled, 4);' : '',
    `    [Win32]::MoveWindow($hWnd, ${x}, ${y}, ${width}, ${height}, $true) | Out-Null;`,
    shouldHideFrame ? `    [Win32]::SetWindowPos($hWnd, [IntPtr]::Zero, ${x}, ${y}, ${width}, ${height}, 0x0024) | Out-Null;` : '',
    '    $applied = $true;',
    '  }',
    '  if ($applied -and -not ' + (shouldHideFrame ? '$true' : '$false') + ') { break }',
    '  Start-Sleep -Milliseconds 250;',
    '} while ((Get-Date) -lt $deadline);'
  ].join(' ');

  const powershell = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    cwd: root,
    stdio: 'ignore',
    detached: true
  });
  powershell.unref();
}

function parsePair(value, fallback) {
  const parsed = String(value)
    .split(/[x,]/i)
    .map((part) => Number.parseInt(part.trim(), 10));
  if (parsed.length !== 2 || parsed.some((part) => !Number.isFinite(part))) return fallback;
  return parsed;
}

function readArgValue(name) {
  const prefixed = `${name}=`;
  const inlineMatch = process.argv.find((arg) => arg.startsWith(prefixed));
  if (inlineMatch) return inlineMatch.slice(prefixed.length).trim();

  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) return null;
  return value.trim();
}
