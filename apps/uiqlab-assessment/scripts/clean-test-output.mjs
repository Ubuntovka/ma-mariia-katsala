import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const generatedOutput = fileURLToPath(new URL('../out', import.meta.url));
await rm(generatedOutput, { recursive: true, force: true });
