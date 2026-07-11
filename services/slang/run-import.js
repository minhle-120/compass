import { runSlangImport } from './importer.js';

runSlangImport().catch((err) => {
  console.error(err);
  process.exit(1);
});
