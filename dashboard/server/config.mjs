import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';

export const root = process.cwd();
export const dataDir = join(root, 'data');
export const configPath = join(dataDir, 'config.json');
export function loadConfig() {
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(configPath)) {
    const example = JSON.parse(readFileSync(new URL('../config.example.json', import.meta.url)));
    writeFileSync(configPath, JSON.stringify({ ...example, token: randomBytes(32).toString('base64url') }, null, 2), { mode: 0o600 });
  }
  return JSON.parse(readFileSync(configPath, 'utf8'));
}
export function saveConfig(config) { mkdirSync(dirname(configPath), { recursive: true }); writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 }); }
