import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=path.dirname(fileURLToPath(import.meta.url));const require=createRequire(process.env.LIFE_OS_DEPS_DIR?path.join(process.env.LIFE_OS_DEPS_DIR,'package.json'):path.resolve(root,'../../alfred-os/package.json'));
const {build}=require('esbuild');
await build({entryPoints:[path.join(root,'server.ts')],outfile:path.join(root,'dist/server.mjs'),bundle:true,platform:'node',format:'esm',target:'node26',alias:{'cloudflare:workers':path.join(root,'local-env.ts')},external:['@anthropic-ai/claude-agent-sdk'],logLevel:'warning'});
