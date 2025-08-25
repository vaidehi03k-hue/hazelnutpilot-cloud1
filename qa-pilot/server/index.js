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

/* ---------------- Hugging Face Inference API ---------------- */
function readHFModel() {
  return (process.env.HF_MODEL || 'mistralai/Mistral-7B-Instruct-v0.3').trim();
}
function readHFToken() {
  const envTok = (process.env.HF_TOKEN || '').trim();
  if (envTok) return envTok;
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
    console.error('[HF] Missing token');
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
        parameters: { max_new_tokens: 800, temperature: 0.2, return_full_text: false },
        options: { wait_for_model: true }
      })
    });
  } catch (e) {
    console.error('[HF] fetch error:', e?.message || e);
    return '';
  }

  const body = await res.text();
  console.log('[HF] status', res.status, res.statusText, 'len', body.length);

  if (!res.ok) {
    console.error('[HF] body head:', body.slice(0, 400));
    return '';
  }

  try {
    const data = JSON.parse(body);
    if (Array.isArray(data) && data[0]?.generated_text) return data[0].generated_text;
    if (data?.generated_text) return data.generated_text;
    if (typeof data === 'string') return data;
  } catch {}
  return body;
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
  if (ext === '.docx') {
    const r = await mammoth.extractRawText({ path: filePath });
    return r.value || '';
  }
  return fs.readFileSync(filePath, 'utf8');
}

/* ---------------- Debug endpoints ---------------- */
app.get('/api/health', (_req, res) => {
  const model = readHFModel();
  const tok = readHFToken();
  res.json({ ok: true, model, hasToken: !!tok, tokenLen: tok.length });
});

app.get('/api/debug/hf-ping', async (_req, res) => {
  const model = readHFModel();
  const token = readHFToken();
  const prompt = 'Respond with exactly {"ok":true}';

  try {
    const r = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 30 }, options: { wait_for_model: true } })
    });
    const body = await r.text();
    return res.json({ status: r.status, ok: r.ok, bodyHead: body.slice(0, 400) });
  } catch (e) {
    return res.json({ ok:false, error: String(e?.message || e) });
  }
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
    fs.writeFileSync(path.join(TMP_DIR, `prd-${prdId}.txt`), text, 'utf8');
    res.json({ prdId, chars: text.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to parse PRD' });
  }
});

/* -------- AI test generation -------- */
app.post('/api/projects/:id/generate-tests', async (req, res) => {
  try {
    const { prdId, baseUrl: baseUrlFromUI } = req.body;
    const prdPath = path.join(TMP_DIR, `prd-${prdId}.txt`);
    if (!fs.existsSync(prdPath)) return res.status(400).json({ error: 'PRD not found' });
    const prdText = fs.readFileSync(prdPath, 'utf8');

    let baseUrl = baseUrlFromUI || '';
    if (!baseUrl) {
      const m = prdText.match(/Base\s*URL:\s*(\S+)/i);
      if (m) baseUrl = m[1];
    }
    if (!baseUrl) baseUrl = 'https://example.com';

    const rules = `
You are a QA engineer. Output ONLY one valid JSON object with key "tests".
Each test must follow:
{"id":"TC-001","title":"short title","priority":"P1|P2|P3","steps":["Go to ${baseUrl}"],"expected":["Text '...' visible"]}
No prose, no code fences. 3–8 tests maximum.
`.trim();

    function stripFences(s=''){ return s.replace(/```[\s\S]*?```/g,'').trim(); }
    function extractJson(s=''){ s=stripFences(s); const a=s.indexOf('{'),b=s.lastIndexOf('}'); if(a>=0&&b>a){ try{return JSON.parse(s.slice(a,b+1))}catch{}} return null; }

    let raw = await callHF(`${rules}\n<PRD>\n${prdText}\n</PRD>`);
    let parsed = extractJson(raw);

    if (!parsed || !Array.isArray(parsed.tests)) {
      console.warn('[GEN-TESTS] Empty parse. Raw head:', (raw||'').slice(0,200));
      raw = await callHF(`${rules}\n<PRD>\n${prdText}\n</PRD>`);
      parsed = extractJson(raw);
    }

    if (!parsed || !Array.isArray(parsed.tests)) return res.json({ tests: [] });

    const tests = parsed.tests.map((t,i)=>({
      id: t.id || `TC-${String(i+1).padStart(3,'0')}`,
      title: t.title || `Test ${i+1}`,
      priority: ['P1','P2','P3'].includes(t.priority)?t.priority:'P2',
      steps: t.steps||[],
      expected: t.expected||[]
    }));
    res.json({ tests });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Test generation failed' });
  }
});

/* ---------------- Recorder import ---------------- */
app.post('/api/projects/:id/import-recorder', async (req, res) => {
  try {
    const { recorderJson } = req.body;
    const steps = [];
    (recorderJson?.steps||[]).forEach(st=>{
      if(st.type==='navigate'&&st.url)steps.push(`Go to ${st.url}`);
      if(st.type==='click')steps.push(`Click '${st?.target?.nodeLabel||'Button'}'`);
      if(st.type==='change'){steps.push(`Fill '${st?.target?.nodeLabel||'Input'}' with '${st.value||''}'`);}
    });
    res.json({ tests:[{id:'TC-REC-001',title:'Recorded flow',priority:'P2',steps,expected:[]}] });
  } catch(e){ console.error(e); res.status(500).json({error:'Import failed'});}
});

/* ---------------- Runs ---------------- */
app.post('/api/projects/:id/run-web', async (req, res) => {
  try {
    const run = await runWebTests(req.body.tests);
    const projects = db.getProjects(); const runs = db.getRuns();
    const proj = projects[req.params.id];
    if(proj){ runs[run.runId]={id:run.runId,projectId:proj.id,...run}; db.saveRuns(runs); proj.runs.push(run.runId); db.saveProjects(projects);}
    res.json(run);
  } catch(e){ console.error(e); res.status(500).json({error:'Web run failed'});}
});

app.post('/api/projects/:id/run-api', async (req, res) => {
  try { res.json(await runApiTests(req.body)); }
  catch(e){ console.error(e); res.status(500).json({error:'API run failed'});}
});

app.get('/api/projects/:id/runs',(req,res)=>{
  const runs=db.getRuns();res.json(Object.values(runs).filter(r=>r.projectId===req.params.id).sort((a,b)=>b.startedAt-a.startedAt));
});

app.get('/api/summary',(_req,res)=>{
  const runs=Object.values(db.getRuns());const total=runs.reduce((n,r)=>n+(r.total||0),0);const passed=runs.reduce((n,r)=>n+(r.passed||0),0);const failed=runs.reduce((n,r)=>n+(r.failed||0),0);
  res.json({total,passed,failed,runs:runs.slice(-10)});
});

app.get('/api/viewer/:token',(req,res)=>{
  const t=db.getTokens()[req.params.token];if(!t)return res.status(404).json({error:'Invalid token'});const proj=db.getProjects()[t.projectId];const runs=Object.values(db.getRuns()).filter(r=>r.projectId===t.projectId);
  res.json({project:{id:proj.id,name:proj.name},runs});
});

/* ---------------- Listen ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT,'0.0.0.0',()=>console.log('QA Pilot server on',PORT));
