// qa-pilot/server/index.js
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import { runWebTests } from './runWebTests.js';
import { runApiTests } from './runApiTests.js';
import { v4 as uuidv4 } from 'uuid';
import db from './db/db.js';
import { fileURLToPath } from 'url';

// -------- AI (Hugging Face Inference API) --------
const HF_MODEL = process.env.HF_MODEL || 'HuggingFaceH4/zephyr-7b-beta';
const HF_TOKEN = process.env.HF_TOKEN || '';

async function callHF(prompt) {
  if (!HF_TOKEN) return '';
  const res = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: { max_new_tokens: 800, temperature: 0.2 },
      options: { wait_for_model: true }
    })
  }).catch(() => null);

  if (!res) return '';
  const data = await res.json();
  if (typeof data === 'string') return data;
  if (Array.isArray(data) && data[0]?.generated_text) return data[0].generated_text;
  if (data?.generated_text) return data.generated_text;
  try { return JSON.stringify(data); } catch { return ''; }
}

// -------- Paths / App bootstrap --------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// Writable directories (use /tmp by default; we also keep project-local for compatibility)
const RUNS_DIR   = process.env.RUNS_DIR   || path.join(__dirname, 'runs');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const TMP_DIR    = process.env.TMP_DIR    || path.join(__dirname, 'tmp');

[RUNS_DIR, UPLOAD_DIR, TMP_DIR].forEach(p => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); });

// Serve built UI
const distPath = path.join(__dirname, '../ui/dist');
app.use(express.static(distPath));
app.get('/', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
app.get('/viewer/*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));

// Serve artifacts
app.use('/runs', express.static(RUNS_DIR));

// Multer upload
const upload = multer({ dest: UPLOAD_DIR });

// -------- Helpers --------
async function extractText(filePath, originalName) {
  const ext = (path.extname(originalName || filePath) || '').toLowerCase();

  if (ext === '.txt' || ext === '.md') {
    return fs.readFileSync(filePath, 'utf8');
  }

  if (ext === '.pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const buf = fs.readFileSync(filePath);
    const pdf = await pdfParse(buf);
    return pdf.text || '';
  }

  if (ext === '.docx') {
    const r = await mammoth.extractRawText({ path: filePath });
    return r.value || '';
  }

  return fs.readFileSync(filePath, 'utf8');
}

// Quick health
app.get('/api/health', (_req, res) => res.json({ ok: true, model: HF_MODEL, hasToken: !!HF_TOKEN }));

/* ---------------- Projects ---------------- */
app.post('/api/projects', (req, res) => {
  const { name } = req.body;
  const projects = db.getProjects();
  const id = uuidv4();
  projects[id] = { id, name, createdAt: Date.now(), runs: [] };
  db.saveProjects(projects);

  // viewer token
  const tokens = db.getTokens();
  const token = uuidv4();
  tokens[token] = { projectId: id, role: 'viewer' };
  db.saveTokens(tokens);

  res.json({ id, name, viewerLink: `/viewer/${token}` });
});

app.get('/api/projects', (_req, res) => res.json(Object.values(db.getProjects())));
app.get('/api/projects/:id', (req, res) => {
  const p = db.getProjects()[req.params.id];
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

/* -------- PRD upload -------- */
app.post('/api/projects/:id/upload-prd', upload.single('file'), async (req, res) => {
  try {
    const text = await extractText(req.file.path, req.file.originalname);
    const prdId = uuidv4();
    const out = path.join(TMP_DIR, `prd-${prdId}.txt`);
    fs.writeFileSync(out, text, 'utf8');
    res.json({ prdId, chars: text.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to parse PRD' });
  }
});

/* -------- AI test generation (HF) -------- */
app.post('/api/projects/:id/generate-tests', async (req, res) => {
  try {
    const { prdId, baseUrl } = req.body;
    const prdPath = path.join(TMP_DIR, `prd-${prdId}.txt`);
    const prdText = fs.readFileSync(prdPath, 'utf8');

    const prompt = `
You are a senior QA. From the PRD between <PRD>...</PRD> create a JSON object {"tests":[...]} of atomic end-to-end WEB test cases for Playwright.

Each test example:
{
 "id":"TC-XXX",
 "title":"short title",
 "priority":"P1|P2|P3",
 "steps":[ "Go to ${baseUrl}", "Click 'Login'", "Fill 'Email' with 'user@example.com'" ],
 "expected":[ "URL contains /dashboard", "Text 'Welcome' visible" ]
}

Rules:
- Return ONLY a single valid JSON object with key "tests". No extra text.
- Steps must be human actions only: Go to, Click 'Text', Fill 'Label' with 'value', Select 'Option' in 'Label'.
- Expected entries are assertions like: "URL contains ...", "Text '...' visible".

<PRD>
${prdText}
</PRD>
`.trim();

    const raw = await callHF(prompt);

    // Robust JSON extraction
    const extractJson = (s) => {
      const a = s.indexOf('{'); const b = s.lastIndexOf('}');
      if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
      return null;
    };

    const parsed = extractJson(raw) || { tests: [] };
    const tests = Array.isArray(parsed.tests) ? parsed.tests : [];

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
    res.json({ tests: [{ id:'TC-REC-001', title:'Recorded user flow', priority:'P2', steps, expected: [] }] });
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

app.get('/api/summary', (_req, res) => {
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

// -------- Listen --------
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('QA Pilot server on', PORT, '— Built by Vaidehi Kulkarni for Mosaic Buildathon');
});
