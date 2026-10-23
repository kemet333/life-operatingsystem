import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const localRoot = fileURLToPath(new URL('.', import.meta.url));
const sourceRoot = fileURLToPath(new URL('../../alfred-os/', import.meta.url));
const dependenciesRoot = process.env.LIFE_OS_DEPS_DIR || sourceRoot;
const requireSource = createRequire(path.join(dependenciesRoot, 'package.json'));
export default async function localWorkspaceConfig() {
 // import() needs file:// URLs for absolute paths on Windows.
 const load = name => import(pathToFileURL(requireSource.resolve(name)).href);
 const { default: react } = await load('@vitejs/plugin-react');
 const { default: tailwind } = await load('@tailwindcss/postcss');
 return {
  root: localRoot,
  base: '/',
  publicDir: path.join(sourceRoot, 'public'),
  cacheDir: path.join(localRoot, 'node_modules/.vite'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': sourceRoot,
      react: path.join(dependenciesRoot, 'node_modules/react'),
      'react-dom': path.join(dependenciesRoot, 'node_modules/react-dom'),
      'lucide-react': path.join(dependenciesRoot, 'node_modules/lucide-react'),
      tailwindcss: path.join(dependenciesRoot, 'node_modules/tailwindcss/index.css'),
    },
    dedupe: ['react', 'react-dom'],
  },
  css: { postcss: { plugins: [tailwind({ base: sourceRoot })] } },
  build: {
    outDir: path.join(localRoot, 'dist/client'),
    emptyOutDir: true,
    target: 'safari18',
    sourcemap: false,
  },
 };
}
