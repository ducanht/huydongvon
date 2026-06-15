import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runPostBuild() {
  const distDir = path.join(__dirname, 'dist');

  // 1. Copy appsscript.json to dist/
  const appsscriptSrc = path.join(__dirname, 'appsscript.json');
  const appsscriptDest = path.join(distDir, 'appsscript.json');
  if (await fs.pathExists(appsscriptSrc)) {
    await fs.copy(appsscriptSrc, appsscriptDest);
    console.log('Successfully copied appsscript.json to dist/');
  } else {
    console.error(`Error: appsscript.json does not exist at ${appsscriptSrc}`);
  }

  // 2. Copy src/backend directory to dist/src/backend
  const backendSrc = path.join(__dirname, 'src', 'backend');
  const backendDest = path.join(distDir, 'src', 'backend');
  if (await fs.pathExists(backendSrc)) {
    await fs.copy(backendSrc, backendDest);
    console.log('Successfully copied src/backend to dist/src/backend');
  } else {
    console.error(`Error: src/backend does not exist at ${backendSrc}`);
  }
}

runPostBuild().catch(err => {
  console.error('Post-build script failed:', err);
  process.exit(1);
});
