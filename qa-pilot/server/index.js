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

/* ---------------- OpenAI (GPT-4o-mini) ---------------- */
async function callAIJson(prompt) {
  const key = (process.env.OPENAI_API_KEY || '').trim();
  if (!key) {
    console.error('[AI] Missing OPENAI_API_KEY');
    return '';
  }

  let res;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        // System message + user prompt; JSON MODE forces valid JSON output
        messages: [
          {
            role: "system",
            content:
              "You are a strict JSON generator. Always return a single JSON object and nothing else."
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 900,
        response_format: { type: "json_object" } // <<< forces valid JSON
      })
    });
  } catch (e) {
    console.error('[AI] fetch error:', e?.message || e);
    return '';
  }

  const body = await res.text();
  if (!res.ok) {
    console.error('[AI] status:', res.status, res.statusText, 'body:', body.slice(0, 300));
    return '';
  }

  try {
    const data = JSON.parse(body);
    return data.choices?.[0]?.message?.content || '';
  } catch (e) {
    console.error('[AI] parse error:', e?.message || e);
    return '';
  }
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

/* ---------------- Serve UI & artifacts ---------------- */
const distPath = path.join(__dirname, '../ui/dist');
app.use(express.static(distPath));
app.get('/', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
app.get('/viewer/*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
app.use('/runs', express.static(RUNS_DIR));

/* ---------------- Uploads ---------------- */
const upload = multer({ dest: UPLOAD_DIR });

/* ---------------- Helpers ---------------- */
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

/* ---------------- Health ---------------- */
app.get('/api/health', (_req, res) => {
  const hasKey = !!(process.env.OPENAI_API_KEY || '').trim();
  res.json({ ok: true, model: "gpt-4o-mini", hasKey });
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

/* ---------------- PRD upload ---------------- */
app.post('/api/projects/:id/upload-prd', upload.single('file'), async (req, res) => {
  try {
    const text = await extractText(req.file.path, req.file.originalname);
    const prdId = uuidv4();
    fs.writeFileSync(path.join(TMP_DIR, `prd-${prdId}.txt`), text, 'utf8');
    res.json({ prdId, chars: text.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to parse PRD' });
  }
});

/* ---------------- AI test generation ---------------- */
app.post('/api/projects/:id/generate-tests', async (req, res) => {
  try {
    const { prdId, baseUrl: baseUrlFromUI } = req.body;

    const prdPath = path.join(TMP_DIR, `prd-${prdId}.txt`);
    if (!fs.existsSync(prdPath)) {
      return res.status(400).json({ error: 'PRD not found. Upload PRD first.' });
    }
    const prdText = fs.readFileSync(prdPath, 'utf8');

    let baseUrl = (baseUrlFromUI || '').trim();
    if (!baseUrl) {
      const m = prdText.match(/Base\s*URL:\s*(\S+)/i);
      if (m) baseUrl = m[1];
    }
    if (!baseUrl) baseUrl = 'https://example.com';

    const rules = `
Return EXACTLY one JSON object (no extra text) with this schema:
{
  "tests": [
    {
      "id": "TC-001",
      "title": "short title",
      "priority": "P1" | "P2" | "P3",
      "steps": [
        "Go to ${baseUrl}",
        "Click '...'",
        "Fill 'Label' with 'value'",
        "Select 'Option' in 'Label'"
      ],
      "expected": [
        "URL contains ...",
        "Text '...' visible"
      ]
    }
  ]
}
Constraints:
- Generate 3 to 8 E2E tests grounded ONLY in the PRD.
- Steps MUST be only from the allowed verbs above.
- Expected MUST be only 'URL contains ...' or 'Text \"...\" visible'.
`.trim();

    const prompt = `${rules}\n<PRD>\n${prdText}\n</PRD>`;

    // Ask OpenAI in JSON mode
    const raw = await callAIJson(prompt);
    if (!raw) return res.json({ tests: [] });

    // raw should already be a pure JSON string thanks to response_format
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      // ultra-rare fallback: try to extract biggest { ... } block
      const a = raw.indexOf('{'); const b = raw.lastIndexOf('}');
      if (a >= 0 && b > a) {
        try { parsed = JSON.parse(raw.slice(a, b+1)); } catch {}
      }
    }

    if (!parsed || !Array.isArray(parsed.tests)) {
      return res.json({ tests: [] });
    }

    const tests = parsed.tests
      .filter(t => t && Array.isArray(t.steps) && Array.isArray(t.expected))
      .map((t, i) => ({
        id: t.id || `TC-${String(i + 1).padStart(3, '0')}`,
        title: t.title || `Test ${i + 1}`,
        priority: ['P1','P2','P3'].includes(t.priority) ? t.priority : 'P2',
        steps: t.steps,
        expected: t.expected
      }));

    res.json({ tests });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Test generation failed' });
  }
});

/* ---------------- Runs ---------------- */
app.post('/api/projects/:id/run-web', async (req, res) => {
  try {
    const { tests } = req.body;
    const run = await runWebTests(tests || []);
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
    res.status(500).json({ error: 'Web run failed' });
  }
});

app.post('/api/projects/:id/run-api', async (req, res) => {
  try {
    const result = await runApiTests(req.body || {});
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

/* ---------------- Listen ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('QA Pilot server on', PORT, '— using OpenAI GPT-4o-mini (JSON mode)');
});
