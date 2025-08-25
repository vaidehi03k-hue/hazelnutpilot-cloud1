import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = __dirname;

function filePath(name){ return path.join(DB_DIR, `${name}.json`); }

function ensureFile(name){
  const p = filePath(name);
  if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify({}, null, 2), 'utf8');
}

function read(name){
  ensureFile(name);
  return JSON.parse(fs.readFileSync(filePath(name), 'utf8'));
}

function write(name, data){
  ensureFile(name);
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), 'utf8');
}

export default {
  getProjects(){ return read('projects'); },
  saveProjects(obj){ write('projects', obj); },

  getRuns(){ return read('runs'); },
  saveRuns(obj){ write('runs', obj); },

  getTokens(){ return read('tokens'); },
  saveTokens(obj){ write('tokens', obj); }
};
