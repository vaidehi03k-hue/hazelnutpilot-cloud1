// qa-pilot/server/runWebTests.js
import { v4 as uuidv4 } from 'uuid';

export async function runWebTests(tests) {
  let passed = 0, failed = 0;
  const runId = uuidv4();
  const results = [];

  for (const t of tests) {
    try {
      if (t.steps?.length) {
        passed++;
        results.push({ id:t.id,title:t.title, status:'pass' });
      } else {
        failed++;
        results.push({ id:t.id,title:t.title, status:'fail' });
      }
    } catch {
      failed++;
      results.push({ id:t.id,title:t.title, status:'fail' });
    }
  }

  return { runId, startedAt: Date.now(), total: tests.length, passed, failed, results };
}
