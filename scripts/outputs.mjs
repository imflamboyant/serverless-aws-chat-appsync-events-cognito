// Reads the stack outputs that `npm run deploy` writes to cdk-outputs.json
import { readFileSync } from 'node:fs';

const STACK = 'ChatAppsyncEventsCognitoStack';

export function stackOutputs() {
    const file = new URL('../cdk-outputs.json', import.meta.url);
    try {
        return JSON.parse(readFileSync(file, 'utf8'))[STACK];
    } catch {
        console.error('cdk-outputs.json not found. Run `npm run deploy` first.');
        process.exit(1);
    }
}
