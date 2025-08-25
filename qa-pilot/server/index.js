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

// -------- AI (mistralai/Mistral-7B-Instruct-v0.3 Inference API) --------
// Read env/secret at runtime so redeploys pick up changes reliably.
function readHFModel() {
  // You can change this default to 'mistralai/Mistral-7B-Instruct-v0.3' if you prefer
  return (process.env.HF_MODEL || 'mistralai/Mistral-7B-Instruct-v0.3').trim();
}
function readHFToken() {
  const envTok = (process.env.HF_TOKEN || '').trim();
  if (envTok) return envTok;
  // Secret File fallback (Render → Settings → Secret Files → name: hf_token)
  try {
    const p = '/etc/secrets/hf_token';
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  } catch {}
  return '';
}

async function callHF(prompt) {
  const token = readHFToken();
  const model = readHFModel();

  if (!token) {
    console.error('[HF] Missing token (HF_TOKEN env and /etc/secrets/hf_token both empty)');
    return '';
  }

  let res;
  try {
    res = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
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
  } catch (e) {
    console.error('[HF] fetch error:', e?.message || e);
    return '';
  }

  const body = await res.text();
  if (!res.ok) {
    console.error('[HF] status:', res.status, res.statusText);
    console.error('[HF] body  :', body.slice(0, 500));
    return '';
  }

  // Try to interpret common HF response shapes
  try {
    const data = JSON.parse(body);
    if (Array.isArray(data) && data[0]?.generated_text) return data[0].generated_text;
    if (data?.generated_text) return data.generated_text;
    if (typeof data === 'string') return data;
    return body;
  } catch {
    return body;
  }
}

// -------- Paths / App bootstrap --------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// Writable directories (container-safe)
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

// Health: shows exactly what the running container can see *now*
app.get('/api/health', (_req, res) => {
  const model = readHFModel();
  const hasToken = !!readHFToken();
  console.log('[HEALTH] model:', model, 'tokenLen:', hasToken ? readHFToken().length : 0);
  res.json({ ok: true, model, hasToken });
});

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
// DEBUG: peek at raw HF output for a given PRD (do NOT keep for production)
app.get('/api/debug/hf-echo', async (req, res) => {
  try {
    const { prdId, baseUrl = 'https://example.com' } = req.query;
    const p = path.join(TMP_DIR, `prd-${prdId}.txt`);
    if (!fs.existsSync(p)) return res.status(400).json({ error: 'No PRD' });
    const prd = fs.readFileSync(p, 'utf8');

    const rules = `You are a JSON bot. Output ONE valid JSON object with key "tests". No prose.`;
    const raw = await callHF(`${rules}\n<PRD>\n${prd}\n</PRD>`);
    res.type('text/plain').send(raw || '(empty)');
  } catch (e) {
    res.status(500).send(String(e?.message || e));
  }
});

/* -------- AI test generation (HF) -------- */
// -------- AI test generation (HF, robust) --------
app.post('/api/projects/:id/generate-tests', async (req, res) => {
  try {
    const { prdId, baseUrl: baseUrlFromUI } = req.body;

    // 1) Load PRD text
    const prdPath = path.join(TMP_DIR, `prd-${prdId}.txt`);
    if (!fs.existsSync(prdPath)) {
      console.error('[GEN-TESTS] Missing PRD file at', prdPath);
      return res.status(400).json({ error: 'PRD not found. Upload PRD first.' });
    }
    const prdText = fs.readFileSync(prdPath, 'utf8');

    // 2) Find baseUrl
    let baseUrl = (baseUrlFromUI || '').trim();
    if (!baseUrl) {
      const m = prdText.match(/Base\s*URL:\s*(\S+)/i);
      if (m) baseUrl = m[1];
    }
    if (!baseUrl) baseUrl = 'https://example.com';

    // 3) Strong JSON-only prompt (works well on Mistral Instruct)
    const rules = `
You are a senior QA. Output ONE valid JSON object ONLY (no prose, no backticks).
Schema exactly: {"tests":[{"id":"TC-001","title":"...","priority":"P1|P2|P3","steps":["Go to ${baseUrl}", "..."],"expected":["Text '...' visible","URL contains ..."]}]}
Constraints:
- 3–8 concise E2E tests for Playwright.
- Steps ONLY from: Go to, Click 'Text', Fill 'Label' with 'value', Select 'Option' in 'Label'.
- Expected ONLY assertions: "URL contains ...", "Text '...' visible".
- Do not include any explanation or markdown code fences.
`.trim();

    const prompt = `${rules}\n<PRD>\n${prdText}\n</PRD>`;

    // 4) Call HF (twice if needed)
    function stripFences(s='') {
      // remove ```json ... ``` and stray leading/trailing non-JSON
      return s.replace(/```[\s\S]*?```/g, '').trim();
    }
    function extractJson(s='') {
      s = stripFences(s);
      const a = s.indexOf('{'); const b = s.lastIndexOf('}');
      if (a >= 0 && b > a) {
        const slice = s.slice(a, b + 1);
        try { return JSON.parse(slice); } catch {}
      }
      return null;
    }

    let raw = await callHF(prompt);
    let parsed = extractJson(raw);

    if (!parsed || !Array.isArray(parsed.tests) || parsed.tests.length === 0) {
      console.warn('[GEN-TESTS] First parse empty. Raw head:', (raw || '').slice(0, 200));
      const prompt2 = `${rules}\nReturn only JSON. If unsure, still output at least 3 tests grounded in the PRD.\n<PRD>\n${prdText}\n</PRD>`;
      raw = await callHF(prompt2);
      parsed = extractJson(raw);
    }

    if (!parsed || !Array.isArray(parsed.tests)) {
      console.error('[GEN-TESTS] Model returned no parseable JSON. Raw head:', (raw || '').slice(0, 400));
      return res.json({ tests: [] });
    }

    // 5) Minimal sanitize
    const tests = parsed.tests
      .filter(t => t && Array.isArray(t.steps) && Array.isArray(t.expected))
      .map((t, i) => ({
        id: t.id || `TC-${String(i + 1).padStart(3, '0')}`,
        title: t.title || `Test ${i + 1}`,
        priority: ['P1','P2','P3'].includes(t.priority) ? t.priority : 'P2',
        steps: t.steps,
        expected: t.expected
      }));

    return res.json({ tests });
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
    const result = await runApiTests(req.body); // { apiTests:[... ] }
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
