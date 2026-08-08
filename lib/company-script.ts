import { readFileSync } from 'fs';
import { join } from 'path';

const scriptPath = join(process.cwd(), 'lib', 'company-script.md');

export const COMPANY_SCRIPT = readFileSync(scriptPath, 'utf8').trim();
