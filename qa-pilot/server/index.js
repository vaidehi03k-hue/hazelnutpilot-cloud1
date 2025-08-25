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

/* ---------------- Hugging Face Helpers ---------------- */
function readHFToken() {
  const envTok = (process.env.HF_TOKEN || '').trim();
  if (envTok) return envTok;
  try {
    const p = '/etc/secrets/hf_token';
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  } catch {}
  return '';
}

// candidate models if HF_MODEL not explicitly set
function candidateModels() {
  const envModel = (process.env.HF_MODEL || '').trim();
  if (envModel) return [envModel];
  return [
    'Qwen/Qwen2.5-7B-Instruct',
    'tiiuae/falcon-7b-instruct',
    'microsoft/Phi-3-mini-4k-instruct',
    'HuggingFaceH4/zephyr-7b-alpha',
    'mistralai/Mistral-7B-Instruct-v0.2'
  ];
}

let _chosenModel = null;

async function callHF(prompt) {
  const token = readHFToken();
  if (!token) {
    console.error('[HF] Missing token');
    return '';
  }

  const modelsToTry = _chosenModel ? [_chosenModel] : candidateModels();

  for (const model of modelsToTry) {
    try {
      const res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: { max_new_tokens: 900, temperature: 0.1, return_full_text: false },
          options: { wait_for_model: true }
        })
      });

      const body = await res.text();
      console.log('[HF]', model, '->', res.status, res.statusText, 'len', body.length);

      if (res.status === 404) continue;
      if (!res.ok) {
        console.error('[HF] error body head:', body.slice(0, 200));
        continue;
      }

      _chosenModel = model;

      try {
        const data = JSON.parse(body);
        if (Array.isArray(data) && data[0]?.generated_text) return data[0].generated_text;
        if (data?.generated_text) return data.generated_text;
        if (typeof data === 'string') return data;
      } catch {}
      return body;
    } catch (e) {
      console.error('[HF] fetch error for', model, e?.message || e);
    }
  }

  console.error('[HF] all candidate models failed');
  return '';
}

/* ---------------- App bootstrap ---------------- */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const RUNS_DIR   = process.env.RUNS_DIR   || path.join(__dirname, 'runs');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const TMP_DIR    = process.env.TMP_DIR    || path.join(__dirname, 'tmp');
[RUNS_DIR, UPLOAD_DIR, TMP_DIR].forEach(p => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); });

const distPath = path.join(__dirname, '../ui/dist');
app.use(express.static(distPath));
app.get('/', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
app.get('/viewer/*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
app.use('/runs', express.static(RUNS_DIR));

const upload = multer({ dest: UPLOAD_DIR });

/* ---------------- Helpers ---------------- */
async function extractText(filePath, originalName) {
  const ext = (path.extname(originalName || filePath) || '').toLowerCase();
  if (ext === '.txt' || ext === '.md') return fs.readFileSync(filePath, 'utf8');
  if (ext === '.pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    return (await pdfParse(fs.readFileSync(filePath))).text || '';
  }
  if (ext === '.docx') return (await mammoth.extractRawText({ path: filePath })).value || '';
  return fs.readFileSync(filePath, 'utf8');
}

/* ---------------- Health ---------------- */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasToken: !!readHFToken(), chosenModel: _chosenModel });
});
app.get('/api/which-model', (_req, res) => {
  res.json({ chosen: _chosenModel, envHF_MODEL: process.env.HF_MODEL || null });
});

/* ---------------- Projects ---------------- */
app.post('/api/projects', (req, res) => {
  const { name } = req.body;
  const projects = db.getProjects();
  const id = uuidv4();
  projects[id] = { id, name, createdAt: Date.now(), runs: [] };
  db.saveProjects(projects);
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
    res.status(500).json({ error: 'Failed to parse PRD' });
  }
});

/* -------- AI test generation -------- */
function extractJson(s = '') {
  if (!s) return null;
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr) && arr[0]?.generated_text) s = arr[0].generated_text;
  } catch {}
  s = s.replace(/```json/g, '').replace(/```/g, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(s.slice(a, b+1)); } catch {}
  }
  return null;
}

app.post('/api/projects/:id/generate-tests', async (req, res) => {
  try {
    const { prdId, baseUrl } = req.body;
    const prdPath = path.join(TMP_DIR, `prd-${prdId}.txt`);
    if (!fs.existsSync(prdPath)) return res.status(400).json({ error: 'PRD not found' });
    const prdText = fs.readFileSync(prdPath, 'utf8');

    const rules = `
You are a senior QA. Return ONLY one valid JSON: {"tests":[...]}.
Each test must have: id, title, priority(P1|P2|P3), steps, expected.
Steps allowed: Go to, Click 'Text', Fill 'Label' with 'value', Select 'Option' in 'Label'.
Expected: "URL contains ...", "Text '...' visible".
`.trim();

    const prompt = `${rules}\nBaseURL: ${baseUrl}\n<PRD>\n${prdText}\n</PRD>`;
    let raw = await callHF(prompt);
    let parsed = extractJson(raw);

    if (!parsed || !Array.isArray(parsed.tests) || parsed.tests.length === 0) {
      raw = await callHF(`${rules}\nIf unsure, still output at least 3 tests.\n<PRD>\n${prdText}\n</PRD>`);
      parsed = extractJson(raw);
    }

    if (!parsed || !Array.isArray(parsed.tests)) return res.json({ tests: [] });
    res.json({ tests: parsed.tests });
  } catch {
    res.status(500).json({ error: 'Test generation failed' });
  }
});

/* ---------------- Other routes ---------------- */
app.post('/api/projects/:id/import-recorder', (req, res) => {
  const steps = [];
  (req.body.recorderJson?.steps || []).forEach(st => {
    if (st.type === 'navigate' && st.url) steps.push(`Go to ${st.url}`);
    if (st.type === 'click') steps.push(`Click '${st?.target?.nodeLabel || 'Button'}'`);
    if (st.type === 'change') steps.push(`Fill '${st?.target?.nodeLabel || 'Input'}' with '${st.value || ''}'`);
  });
  res.json({ tests: [{ id:'TC-REC-001', title:'Recorded flow', priority:'P2', steps, expected: [] }] });
});

app.post('/api/projects/:id/run-web', async (req, res) => {
  const run = await runWebTests(req.body.tests || []);
  const projects = db.getProjects(); const runs = db.getRuns();
  const proj = projects[req.params.id];
  if (proj) {
    runs[run.runId] = { id: run.runId, projectId: proj.id, ...run };
    db.saveRuns(runs);
    proj.runs.push(run.runId);
    db.saveProjects(projects);
  }
  res.json(run);
});
app.post('/api/projects/:id/run-api', async (req, res) => {
  res.json(await runApiTests(req.body));
});
app.get('/api/projects/:id/runs', (req, res) => {
  const runs = db.getRuns();
  res.json(Object.values(runs).filter(r => r.projectId === req.params.id).sort((a,b)=>b.startedAt-a.startedAt));
});
app.get('/api/summary', (_req, res) => {
  const runs = Object.values(db.getRuns());
  res.json({
    total: runs.reduce((n,r)=>n+(r.total||0),0),
    passed: runs.reduce((n,r)=>n+(r.passed||0),0),
    failed: runs.reduce((n,r)=>n+(r.failed||0),0),
    runs: runs.slice(-10)
  });
});
app.get('/api/viewer/:token', (req,res)=>{
  const t=db.getTokens()[req.params.token];
  if(!t)return res.status(404).json({error:'Invalid token'});
  const project=db.getProjects()[t.projectId];
  const runs=Object.values(db.getRuns()).filter(r=>r.projectId===t.projectId);
  res.json({project:{id:project.id,name:project.name},runs});
});

/* ---------------- Listen ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT,'0.0.0.0',()=>console.log('QA Pilot on',PORT));
