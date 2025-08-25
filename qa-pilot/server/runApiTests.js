import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import axios from 'axios';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stamp = () => new Date().toISOString().replace(/[:.]/g,'-');

async function writeIssuesExcel(runDir, issues) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('API_Issues');
  ws.columns = [
    { header:'Bug ID', key:'bugId', width:12 },
    { header:'Title', key:'title', width:40 },
    { header:'Severity', key:'severity', width:12 },
    { header:'Priority', key:'priority', width:10 },
    { header:'Request', key:'request', width:60 },
    { header:'Expected', key:'expected', width:50 },
    { header:'Actual', key:'actual', width:50 },
    { header:'Endpoint', key:'endpoint', width:40 },
    { header:'Method', key:'method', width:10 },
    { header:'Test ID', key:'testId', width:14 },
    { header:'Timestamp', key:'ts', width:24 }
  ];
  issues.forEach(i => ws.addRow(i));
  const out = path.join(runDir,'API_Issues.xlsx');
  await wb.xlsx.writeFile(out);
  return out;
}

export async function runApiTests(payload) {
  const tests = payload.apiTests || [];
  const runId = 'api-' + stamp();
  const runDirAbs = path.join(__dirname,'runs', runId);
  await fs.promises.mkdir(runDirAbs,{recursive:true});

  const issues = [];
  let passed=0, failed=0;

  for (const t of tests) {
    try {
      const res = await axios({
        method: t.method || 'GET',
        url: t.url,
        headers: t.headers || {},
        data: t.body || undefined,
        timeout: 15000
      });

      const exp = t.expect || {};
      if (exp.status && res.status !== exp.status) {
        throw new Error(`Expected status ${exp.status} but got ${res.status}`);
      }
      if (exp.jsonPathEquals) {
        for (const jp in exp.jsonPathEquals) {
          const expected = exp.jsonPathEquals[jp];
          const actual = jp.split('.').reduce((acc,k)=> (acc?acc[k]:undefined), res.data);
          if (actual !== expected) throw new Error(`Expected ${jp}=${expected} but got ${actual}`);
        }
      }
      passed++;
    } catch(e) {
      failed++;
      issues.push({
        bugId: `API-${issues.length+1}`,
        title: `API Fail: ${t.title || t.id || t.url}`,
        severity: 'Major',
        priority: 'P2',
        request: `${t.method||'GET'} ${t.url}\nheaders=${JSON.stringify(t.headers||{})}\nbody=${JSON.stringify(t.body||{})}`,
        expected: JSON.stringify(t.expect||{}),
        actual: e.message,
        endpoint: t.url,
        method: t.method||'GET',
        testId: t.id||'',
        ts: new Date().toISOString()
      });
    }
  }

  const excelRel = `/runs/${runId}/API_Issues.xlsx`;
  await writeIssuesExcel(runDirAbs, issues);
  return { runId, runDir: `/runs/${runId}`, passed, failed, total: passed+failed, excelPath: excelRel, startedAt: Date.now(), issues };
}
