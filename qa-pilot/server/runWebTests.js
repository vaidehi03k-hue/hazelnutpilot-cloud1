import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ensureDir = async (p) => fs.promises.mkdir(p, { recursive: true });
const stamp = () => new Date().toISOString().replace(/[:.]/g,'-');
const safe = s => (s||'').toString().replace(/[^\w\-]+/g,'_').slice(0,60);

async function writeIssuesExcel(runDir, issues) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Issues');
  ws.columns = [
    { header:'Bug ID', key:'bugId', width:12 },
    { header:'Title', key:'title', width:40 },
    { header:'Severity', key:'severity', width:12 },
    { header:'Priority', key:'priority', width:10 },
    { header:'Steps', key:'steps', width:60 },
    { header:'Expected', key:'expected', width:44 },
    { header:'Actual', key:'actual', width:44 },
    { header:'Screenshot', key:'screenshot', width:44 },
    { header:'Video', key:'video', width:40 },
    { header:'Trace', key:'trace', width:40 },
    { header:'Environment', key:'env', width:20 },
    { header:'Test ID', key:'testId', width:14 },
    { header:'Timestamp', key:'ts', width:24 }
  ];
  issues.forEach(i => ws.addRow(i));
  const out = path.join(runDir,'Issues.xlsx');
  await wb.xlsx.writeFile(out);
  return out;
}

async function runSingle(page, test, testDir) {
  const stepsLog = [];
  let lastScreenshot=null;

  const shot = async (label='step') => {
    const p = path.join(testDir, `${safe(label)}.png`);
    await page.screenshot({ path: p });
    lastScreenshot = p;
  };

  for (const step of (test.steps||[])) {
    const s = step.trim();
    stepsLog.push(s);

    if (s.toLowerCase().startsWith('go to ')) {
      await page.goto(s.substring(6).trim(), { waitUntil:'domcontentloaded' });
    } else if (s.toLowerCase().startsWith("click '")) {
      const label = s.split("'")[1];
      const btn = page.getByRole('button', { name: label });
      if (await btn.count()) await btn.first().click();
      else await page.getByText(label, { exact:false }).first().click();
    } else if (s.toLowerCase().startsWith("fill '")) {
      const m = s.match(/Fill '(.+?)' with '(.+?)'/i);
      if (m) {
        const field = m[1], val = m[2];
        const loc = page.getByLabel(field);
        if (await loc.count()) await loc.first().fill(val);
        else await page.getByPlaceholder(field).first().fill(val);
      }
    } else if (s.toLowerCase().startsWith("select '")) {
      const m = s.match(/Select '(.+?)' in '(.+?)'/i);
      if (m) {
        const option = m[1], label = m[2];
        await page.getByLabel(label).selectOption({ label: option });
      }
    } else if (s.toLowerCase().startsWith('expect url contains')) {
      const frag = s.replace(/expect url contains /i,'').replace(/['"]/g,'').trim();
      if (!page.url().includes(frag)) throw new Error(`URL does not contain '${frag}'`);
    } else if (s.toLowerCase().startsWith("expect text '")) {
      const text = s.split("'")[1];
      const ok = await page.getByText(text, { exact:false }).first().isVisible().catch(()=>false);
      if (!ok) throw new Error(`Text '${text}' not visible`);
    }
    await shot(s);
  }

  if (Array.isArray(test.expected)) {
    for (const exp of test.expected) {
      if (exp.toLowerCase().startsWith('url contains')) {
        const frag = exp.split(' ').slice(2).join(' ').replace(/['"]/g,'').trim();
        if (!page.url().includes(frag)) throw new Error(`URL does not contain '${frag}'`);
      }
      if (exp.toLowerCase().includes('text') && exp.toLowerCase().includes('visible')) {
        const txt = exp.split("'")[1] || exp;
        const ok = await page.getByText(txt, { exact:false }).first().isVisible().catch(()=>false);
        if (!ok) throw new Error(`Text '${txt}' not visible`);
      }
    }
  }
  return { stepsLog, lastScreenshot };
}

export async function runWebTests(payload) {
  const tests = payload.tests || payload;
  const runId = stamp();
  const runDirAbs = path.join(__dirname, 'runs', runId);
  await ensureDir(runDirAbs);

  let passed=0, failed=0;
  const issues=[];

  const browser = await chromium.launch({ headless: true });

  for (const t of tests) {
    const ctx = await browser.newContext({ recordVideo: { dir: runDirAbs } });
    const page = await ctx.newPage();
    const testDir = path.join(runDirAbs, safe(t.id || t.title || 'test'));
    await ensureDir(testDir);

    try {
      await runSingle(page, t, testDir);
      await ctx.close();
      passed++;
    } catch (e) {
      const failShot = path.join(testDir, 'failure.png');
      await page.screenshot({ path: failShot }).catch(()=>{});
      const vid = (await page.video()?.path()) || '';
      await ctx.close();

      issues.push({
        bugId: `BUG-${issues.length+1}`,
        title: `Fail: ${t.title || t.id}`,
        severity: (t.priority==='P1'?'Critical': t.priority==='P2'?'Major':'Minor'),
        priority: t.priority || 'P2',
        steps: (t.steps||[]).map((s,i)=>`${i+1}. ${s}`).join('\n'),
        expected: (t.expected||[]).join(' | '),
        actual: e.message,
        screenshot: `/runs/${runId}/${safe(t.id||t.title||'test')}/failure.png`,
        video: vid ? `/runs/${runId}/${path.basename(vid)}` : '',
        trace: '',
        env: 'chromium-headless',
        testId: t.id || '',
        ts: new Date().toISOString()
      });
      failed++;
    }
  }
  await browser.close();

  const excelPathRel = `/runs/${runId}/Issues.xlsx`;
  await writeIssuesExcel(runDirAbs, issues);
  return { runId, runDir: `/runs/${runId}`, passed, failed, total: passed+failed, excelPath: excelPathRel, startedAt: Date.now(), issues };
}
