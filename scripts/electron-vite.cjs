const { spawn } = require('node:child_process');
const { join } = require('node:path');

const command = process.argv[2] ?? 'dev';
const flags = new Set(process.argv.slice(3));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

if (flags.has('--gpu')) {
  env.SKINDECK_ENABLE_GPU = '1';
  delete env.SKINDECK_GPU_MODE;
}

if (flags.has('--gpu-off')) {
  env.SKINDECK_GPU_MODE = 'off';
  delete env.SKINDECK_ENABLE_GPU;
}

const binPath = join(__dirname, '..', 'node_modules', 'electron-vite', 'bin', 'electron-vite.js');
const child = spawn(process.execPath, [binPath, command], {
  cwd: join(__dirname, '..'),
  env,
  stdio: 'inherit'
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
