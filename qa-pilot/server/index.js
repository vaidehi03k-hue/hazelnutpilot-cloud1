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

/* ---------------- AI Providers (OpenAI or Groq) ---------------- */
const PROVIDER = (process.env.AI_PROVIDER || 'openai').toLowerCase();
const OPENAI_KEY = (process.env.OPENAI_API_KEY || '').trim();
const GROQ_KEY = (process.env.GROQ_API_KEY || '').trim();

async function callAIJson(prompt) {
  if (PROVIDER === 'groq') return await callGroqJSON(prompt);
  return await callOpenAIJSON(prompt);
}

async function callOpenAIJSON(prompt) {
  if (!OPENAI_KEY) return '';
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a strict JSON generator. Return one JSON object only." },
          { role: "user", content: prompt }
        ],
        temperature: 0.15,
        max_tokens: 1000,
        response_format: { type: "json_object" }
      })
    });
    const body = await res.text();
    if (!res.ok) {
      console.error('[OpenAI] status:', res.status, res.statusText, 'body:', body.slice(0, 300));
      return '';
    }
    const data = JSON.parse(body);
    return data.choices?.[0]?.message?.content || '';
  } catch (e) {
    console.error('[OpenAI] error:', e?.message || e);
    return '';
  }
}

async function callGroqJSON(prompt) {
  if (!GROQ_KEY) return '';
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: "You are a strict JSON generator. Return one JSON object only." },
          { role: "user", content: prompt }
        ],
        temperature: 0.15,
        max_tokens: 1000
      })
    });
    const body = await res.text();
    if (!res.ok) {
      console.error('[Groq] status:', res.status, res.statusText, 'body:', body.slice(0, 300));
      return '';
    }
    const data = JSON.parse(body);
    return data.choices?.[0]?.message?.content || '';
  } catch (e) {
    console.error('[Groq] error:', e?.message || e);
    return '';
  }
}

function stripFences(s='') { return s.replace(/```[\s\S]*?```/g, '').trim(); }
function tryParseJson(s='') {
  if (!s) return null;
  try { return JSON.parse(s); } catch {}
  s = stripFences(s);
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(s.slice(a, b+1)); } catch {}
  }
  return null;
}

/* ---------------- Paths ---------------- */
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

async function extractText(filePath, originalName) {
  const ext = (path.extname(originalName || filePath) || '').toLowerCase();
  if (ext === '.txt' || ext === '.md') return fs.readFileSync(filePath, 'utf8');
  if (ext === '.pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    return (await pdfParse(fs.readFileSync(filePath))).text || '';
  }
  if (ext === '.docx') {
    return (await mammoth.extractRawText({ path: filePath })).value || '';
  }
  return fs.readFileSync(filePath, 'utf8');
}

/* ---------------- Health ---------------- */
app.get('/api/health', (_req, res) => {
  res.json({ ok:true, provider:PROVIDER, hasOpenAI:!!OPENAI_KEY, hasGroq:!!GROQ_KEY });
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

/* -------- PRD Upload -------- */
app.post('/api/projects/:id/upload-prd', upload.single('file'), async (req, res) => {
  try {
    const text = await extractText(req.file.path, req.file.originalname);
    const prdId = uuidv4();
    fs.writeFileSync(path.join(TMP_DIR, `prd-${prdId}.txt`), text, 'utf8');
    res.json({ prdId, chars: text.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to parse PRD' });
  }
});

/* -------- Test Generation (AI + Fallback) -------- */
app.post('/api/projects/:id/generate-tests', async (req, res) => {
  try {
    const { prdId, baseUrl: baseUrlFromUI } = req.body;
    const prdPath = path.join(TMP_DIR, `prd-${prdId}.txt`);
    if (!fs.existsSync(prdPath)) return res.status(400).json({ error: 'PRD not found.' });
    const prdText = fs.readFileSync(prdPath, 'utf8');

    let baseUrl = (baseUrlFromUI || '').trim();
    const m = prdText.match(/Base\s*URL:\s*(\S+)/i);
    if (!baseUrl && m) baseUrl = m[1];
    if (!baseUrl) baseUrl = 'https://example.com';

    const rules = `
Return EXACTLY one JSON object {"tests":[...]} with schema:
{"id":"TC-001","title":"short","priority":"P1|P2|P3","steps":["Go to ${baseUrl}"],"expected":["Text '...' visible"]}
`.trim();

    let raw = await callAIJson(`${rules}\n<PRD>\n${prdText}\n</PRD>`);
    let parsed = tryParseJson(raw);
    if (!parsed || !Array.isArray(parsed.tests)) {
      raw = await callAIJson(`${rules}\nReturn only JSON object.\n<PRD>\n${prdText}\n</PRD>`);
      parsed = tryParseJson(raw);
    }

    let tests = [];
    if (parsed && Array.isArray(parsed.tests)) {
      tests = parsed.tests.map((t,i)=>({
        id: t.id || `TC-${String(i+1).padStart(3,'0')}`,
        title: t.title || `Test ${i+1}`,
        priority: ['P1','P2','P3'].includes(t.priority)?t.priority:'P2',
        steps: t.steps||[],
        expected: t.expected||[]
      }));
    }
    if (tests.length === 0) tests = heuristicFromPRD(prdText, baseUrl);

    res.json({ tests });
  } catch (e) {
    res.status(500).json({ error: 'Test generation failed' });
  }
});

function heuristicFromPRD(prdText, baseUrl) {
  const tests = [];
  if (/login/i.test(prdText)) tests.push({
    id:'TC-001',title:'Valid login works',priority:'P1',
    steps:[`Go to ${baseUrl}`,`Fill 'Username' with 'user'`,`Fill 'Password' with 'secret'`,`Click 'Login'`],
    expected:[`URL contains /inventory`,`Text 'Products' visible`]
  });
  if (/cart|checkout/i.test(prdText)) tests.push({
    id:'TC-002',title:'Add item to cart',priority:'P2',
    steps:[`Go to ${baseUrl}`,`Click 'Add to cart'`],
    expected:[`Text 'Cart' visible`]
  });
  if (!tests.length) tests.push({
    id:'TC-001',title:'Homepage loads',priority:'P2',
    steps:[`Go to ${baseUrl}`],expected:[`Text 'Home' visible`]
  });
  return tests;
}

/* ---------------- Runs ---------------- */
app.post('/api/projects/:id/run-web', async (req,res)=>{
  try {
    const { tests } = req.body;
    const run = await runWebTests(tests);
    res.json(run);
  } catch { res.status(500).json({error:'Web run failed'}); }
});
app.post('/api/projects/:id/run-api', async (req,res)=>{
  try { res.json(await runApiTests(req.body)); }
  catch{ res.status(500).json({error:'API run failed'}); }
});
app.get('/api/projects/:id/runs',(req,res)=>{
  res.json(Object.values(db.getRuns()).filter(r=>r.projectId===req.params.id));
});
app.get('/api/summary',(_req,res)=>{
  const runs = Object.values(db.getRuns());
  const total=runs.reduce((n,r)=>n+(r.total||0),0);
  const passed=runs.reduce((n,r)=>n+(r.passed||0),0);
  const failed=runs.reduce((n,r)=>n+(r.failed||0),0);
  res.json({total,passed,failed,runs:runs.slice(-10)});
});
app.get('/api/viewer/:token',(req,res)=>{
  const t=db.getTokens()[req.params.token];
  if(!t)return res.status(404).json({error:'Invalid token'});
  const p=db.getProjects()[t.projectId];
  res.json({project:{id:p.id,name:p.name},runs:Object.values(db.getRuns()).filter(r=>r.projectId===p.id)});
});

const PORT = process.env.PORT || 10000;
app.listen(PORT,'0.0.0.0',()=>console.log('QA Pilot running on',PORT));
