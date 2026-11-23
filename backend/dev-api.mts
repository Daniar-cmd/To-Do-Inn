import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { parseEnv } from 'node:util';

const args = process.argv.slice(2);
const command = args.join(' ');
if (!['', 'diagnostics:check', 'schema:init', 'schema:baseline', 'schema:baseline --apply', 'schema:migrate', 'tasks:repeat'].includes(command)) {
  console.error('Expected diagnostics:check, schema:init, schema:baseline [--apply], schema:migrate or tasks:repeat.');
  process.exit(2);
}

const configFile = new URL('../.env.aspnet.dev', import.meta.url);
let config;
try {
  config = parseEnv(readFileSync(configFile, 'utf8'));
} catch {
  console.error('Configure .env.aspnet.dev using .env.aspnet.dev.example.');
  process.exit(1);
}
if (!config.ConnectionStrings__Workspace?.trim()) {
  console.error('Set ConnectionStrings__Workspace in .env.aspnet.dev to the local workspace database.');
  process.exit(1);
}

const keys = config.AuthPreview__SessionKeyDirectory || join(homedir(), '.local', 'share', 'todo-inn', 'dev-keys');
if (!isAbsolute(keys)) {
  console.error('AuthPreview__SessionKeyDirectory must be an absolute path.');
  process.exit(1);
}
if (!command) mkdirSync(keys, { recursive: true, mode: 0o700 });

const child = spawn('dotnet', ['run', '--project', 'backend/Workspace.Api', '--no-launch-profile', '--', ...args], {
  cwd: new URL('..', import.meta.url),
  stdio: 'inherit',
  env: {
    ...process.env,
    ...config,
    ASPNETCORE_ENVIRONMENT: 'Development',
    DOTNET_ENVIRONMENT: 'Development',
    ASPNETCORE_URLS: 'http://127.0.0.1:8002',
    AuthPreview__Enabled: 'true',
    AuthPreview__AllowLoopbackHttp: 'true',
    AuthPreview__SessionKeyDirectory: keys,
    WorkspaceBridge__Secret: '',
    Registration__Enabled: config.Registration__Enabled || 'false',
  },
});
child.on('error', () => {
  console.error('Could not start dotnet. Install the .NET 10 SDK and check PATH.');
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
});
