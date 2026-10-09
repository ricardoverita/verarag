import { readFileSync } from 'node:fs';

// Works from src/ during tests and from dist/ at runtime: both sit next to package.json.
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export const APP_VERSION = manifest.version;
