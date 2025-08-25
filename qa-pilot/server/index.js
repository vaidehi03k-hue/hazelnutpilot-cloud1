import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { parseDocx } from 'docx-parser';
import { runWebTests } from './runWebTests.js';
import { runApiTests } from './runApiTests.js';
import { v4 as uuidv4 } from 'uuid';
import db from './db/db.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// ensure folders
['uploads','tmp','runs'].forEach(d => {
  const p = path.join(__dirname, d);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// static hosting for artifacts
app.use('/runs', express.static(path.join(__dirname, 'runs')));

const upload = multer({ dest: path.join(__dirname, 'uploads') });

async function extractText(filePath, originalName) {
  const ext = (path.extname(originalName || filePath) || '').toLowerCase();
  if (ext === '.txt' || ext === '.md') return fs.readFileSync(filePath, 'utf8');
  if (ext === '.pdf') {
   if (filePath.endsWith(".pdf")) {
      const pdfParse = require("pdf-parse"); // require here
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
  text = pdfData.text;
}
    return data.text;
  }
  if (ext === '.docx') return await parseDocx(filePath);
  return fs.readFileSync(filePath, 'utf8');
}

async function ollama(prompt) {
  // Node 18+ has global fetch
  const res = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ model: 'llama3', prompt, stream: false })
  }).catch(() => null);
  if (!res) return '{"tests":[]}';
  const json = await res.json();
  return json.response || '{"tests":[]}';
}

/* ---------------- Projects ---------------- */
app.post('/api/projects', (req, res) => {
  const { name } = req.body;
  const projects = db.getProjects();
  const id = uuidv4();
  projects[id] = { id, name, createdAt: Date.now(), runs: [] };
  db.saveProjects(projects);

  // create viewer token
  const tokens = db.getTokens();
  const token = uuidv4();
  tokens[token] = { projectId: id, role: 'viewer' };
  db.saveTokens(tokens);

  res.json({ id, name, viewerLink: `/viewer/${token}` });
});

app.get('/api/projects', (req, res) => res.json(Object.values(db.getProjects())));
app.get('/api/projects/:id', (req, res) => {
  const p = db.getProjects()[req.params.id];
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

/* -------- PRD upload + AI test generation -------- */
app.post('/api/projects/:id/upload-prd', upload.single('file'), async (req, res) => {
  try {
    const text = await extractText(req.file.path, req.file.originalname);
    const prdId = uuidv4();
    const out = path.join(__dirname, 'tmp', `prd-${prdId}.txt`);
    fs.writeFileSync(out, text, 'utf8');
    res.json({ prdId, chars: text.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to parse PRD' });
  }
});

app.post('/api/projects/:id/generate-tests', async (req, res) => {
  try {
    const { prdId, baseUrl } = req.body;
    const prdPath = path.join(__dirname, 'tmp', `prd-${prdId}.txt`);
    const prdText = fs.readFileSync(prdPath, 'utf8');

    const prompt = `
You are a senior QA. From the PRD between <PRD>...</PRD> create a JSON object {"tests":[...]} of atomic end-to-end WEB test cases for Playwright.
Each test:
{
 "id":"TC-XXX",
 "title":"short title",
 "priority":"P1|P2|P3",
 "steps":[ "Go to ${baseUrl}", "Click 'Login'", "Fill 'Email' with 'user@example.com'" ],
 "expected":[ "URL contains /dashboard", "Text 'Welcome' is visible" ]
}
Use only human-oriented actions: Go to, Click 'Text', Fill 'Label' with 'value', Select 'Option' in 'Label', Expect url contains '...', Expect text '...' visible.
Return ONLY valid JSON.

<PRD>
${prdText}
</PRD>
`.trim();

    const raw = await ollama(prompt);
    const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
    const jsonStr = (start >= 0 && end > start) ? raw.slice(start, end+1) : '{"tests":[]}';
    const tests = JSON.parse(jsonStr);
    res.json({ tests });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Test generation failed' });
  }
});

/* -------- Import "recorded flow" from Chrome DevTools -------- */
app.post('/api/projects/:id/import-recorder', async (req, res) => {
  try {
    const { recorderJson } = req.body;
    const steps = [];
    (recorderJson?.steps || []).forEach(st => {
      if (st.type === 'navigate' && st.url) steps.push(`Go to ${st.url}`);
      if (st.type === 'click') steps.push(`Click '${st?.target?.nodeLabel || 'Button'}'`);
      if (st.type === 'change') {
        const val = st.value || '';
        steps.push(`Fill '${st?.target?.nodeLabel || 'Input'}' with '${val}'`);
      }
    });
    const tests = { tests: [{ id:'TC-REC-001', title:'Recorded user flow', priority:'P2', steps, expected: [] }] };
    res.json(tests);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Import failed' });
  }
});

/* ---------------- Runs ---------------- */
app.post('/api/projects/:id/run-web', async (req, res) => {
  try {
    const { tests } = req.body; // { tests: [...] }
    const run = await runWebTests(tests);
    const projects = db.getProjects();
    const runs = db.getRuns();
    const proj = projects[req.params.id];
    if (proj) {
      runs[run.runId] = { id: run.runId, projectId: proj.id, ...run };
      db.saveRuns(runs);
      proj.runs.push(run.runId);
      db.saveProjects(projects);
    }
    res.json(run);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error:'Web run failed' });
  }
});

app.post('/api/projects/:id/run-api', async (req, res) => {
  try {
    const result = await runApiTests(req.body); // { apiTests:[...] }
    res.json(result);
  } catch(e) {
    console.error(e);
    res.status(500).json({ error:'API run failed' });
  }
});

app.get('/api/projects/:id/runs', (req, res) => {
  const runs = db.getRuns();
  const list = Object.values(runs).filter(r => r.projectId === req.params.id);
  res.json(list.sort((a,b)=> b.startedAt - a.startedAt));
});

app.get('/api/summary', (req, res) => {
  const runs = Object.values(db.getRuns());
  const total = runs.reduce((n, r)=> n + (r.total||0), 0);
  const passed = runs.reduce((n, r)=> n + (r.passed||0), 0);
  const failed = runs.reduce((n, r)=> n + (r.failed||0), 0);
  res.json({ total, passed, failed, runs: runs.slice(-10) });
});

/* ---------------- Viewer ---------------- */
app.get('/api/viewer/:token', (req, res) => {
  const tokens = db.getTokens();
  const t = tokens[req.params.token];
  if (!t) return res.status(404).json({ error:'Invalid token' });
  const project = db.getProjects()[t.projectId];
  const runs = Object.values(db.getRuns()).filter(r=> r.projectId === t.projectId);
  res.json({ project: { id: project.id, name: project.name }, runs });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, ()=> console.log('QA Pilot server on', PORT, '— Built by Vaidehi Kulkarni for Mosaic Buildathon'));
