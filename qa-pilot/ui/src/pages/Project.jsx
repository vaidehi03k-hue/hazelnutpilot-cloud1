import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import api from '../api'

export default function Project(){
  const { id } = useParams()

  const [proj, setProj] = useState(null)
  const [runs, setRuns] = useState([])

  const [prdId, setPrdId] = useState(null)
  const [baseUrl, setBaseUrl] = useState('https://demo.playwright.dev/todomvc')
  const [tests, setTests] = useState(null)
  const [genLoading, setGenLoading] = useState(false)

  const [recorderJson, setRecorderJson] = useState('')

  const [webRunning, setWebRunning] = useState(false)
  const [apiRunning, setApiRunning] = useState(false)
  const [excelWeb, setExcelWeb] = useState(null)
  const [excelApi, setExcelApi] = useState(null)
  const [lastRunSummary, setLastRunSummary] = useState(null)

  useEffect(()=>{
    (async ()=>{
      const p = await api.get(`/projects/${id}`); setProj(p.data)
      const r = await api.get(`/projects/${id}/runs`); setRuns(r.data)
    })()
  },[id])

  async function uploadPRD(e){
    const f = e.target.files[0]; if(!f) return
    const form = new FormData(); form.append('file', f)
    const { data } = await api.post(`/projects/${id}/upload-prd`, form)
    setPrdId(data.prdId)
  }

  async function genTests(){
    if(!prdId) return
    try {
      setGenLoading(true)
      const { data } = await api.post(`/projects/${id}/generate-tests`, { prdId, baseUrl })
      setTests(data.tests)
    } finally {
      setGenLoading(false)
    }
  }

  async function importRecorder(){
    if (!recorderJson) return
    try {
      const parsed = JSON.parse(recorderJson)
      const { data } = await api.post(`/projects/${id}/import-recorder`, { recorderJson: parsed })
      setTests(data)
    } catch (e) {
      alert('Invalid Recorder JSON'); 
    }
  }

  async function runWeb(){
    if(!tests) return
    try {
      setWebRunning(true)
      const { data } = await api.post(`/projects/${id}/run-web`, tests)
      setExcelWeb(data.excelPath)
      setLastRunSummary({ passed: data.passed, failed: data.failed, total: data.total })
      const r = await api.get(`/projects/${id}/runs`); setRuns(r.data)
    } finally {
      setWebRunning(false)
    }
  }

  async function runApi(){
    try {
      setApiRunning(true)
      const payload = {
        apiTests: [
          { id:"API-1", title:"Todos 1", method:"GET", url:"https://jsonplaceholder.typicode.com/todos/1", expect:{ status:200, jsonPathEquals:{ "id":1 } } }
        ]
      }
      const { data } = await api.post(`/projects/${id}/run-api`, payload)
      setExcelApi(data.excelPath)
    } finally {
      setApiRunning(false)
    }
  }

  return (
    <div className="grid gap-6">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-2xl p-5 bg-white/70 backdrop-blur-xs border shadow"
      >
        <h2 className="text-2xl font-bold">{proj?.name || 'Project'}</h2>
        <p className="text-sm text-gray-600">PRD → AI tests → Web/API runs → Issues.xlsx</p>
      </motion.div>

      <div className="grid md:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }}
          className="bg-white rounded-2xl p-5 shadow hover:shadow-xl transition"
        >
          <h3 className="font-semibold mb-3">1) Upload PRD & Generate Tests</h3>
          <input type="file" onChange={uploadPRD} className="block text-sm" />
          <div className="mt-2 text-sm text-gray-600">PRD ID: {prdId || '—'}</div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-sm text-gray-600">Base URL</label>
            <input
              value={baseUrl}
              onChange={e=>setBaseUrl(e.target.value)}
              className="border rounded-xl px-3 py-2 w-80 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={genTests}
              disabled={!prdId || genLoading}
              className="px-3 py-2 rounded-xl bg-blue-600 text-white shadow hover:shadow-lg hover:-translate-y-0.5 transition disabled:opacity-50"
            >
              {genLoading ? 'Generating…' : 'Generate Tests (AI)'}
            </button>
          </div>

          {!tests && (
            <div className="mt-3 text-sm text-gray-500 animate-pulse">
              Waiting for PRD → Generate Tests…
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.08 }}
          className="bg-white rounded-2xl p-5 shadow hover:shadow-xl transition"
        >
          <h3 className="font-semibold mb-3">2) Import Recorded Flow (Chrome DevTools)</h3>
          <textarea
            value={recorderJson}
            onChange={e=>setRecorderJson(e.target.value)}
            placeholder="Paste Recorder JSON here"
            className="w-full h-40 border rounded-xl p-3 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="mt-2">
            <button
              onClick={importRecorder}
              className="px-3 py-2 rounded-xl bg-indigo-600 text-white shadow hover:shadow-lg hover:-translate-y-0.5 transition"
            >
              Import
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Tip: Chrome DevTools → Recorder → Record → Export as JSON → paste here.
          </p>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.11 }}
        className="bg-gradient-to-br from-white to-gray-50 rounded-2xl p-5 shadow border"
      >
        <h3 className="font-semibold mb-3">Generated / Imported Tests</h3>
        <div className="rounded-xl border bg-white/70">
          <pre className="text-xs max-h-64 overflow-auto p-3">
            {JSON.stringify(tests, null, 2) || '—'}
          </pre>
        </div>

        <div className="mt-3 flex gap-3">
          <button
            onClick={runWeb}
            disabled={!tests || webRunning}
            className="px-3 py-2 rounded-xl bg-emerald-600 text-white shadow hover:shadow-lg hover:-translate-y-0.5 transition disabled:opacity-50"
          >
            {webRunning ? 'Running Web…' : 'Run Web'}
          </button>

          <button
            onClick={runApi}
            disabled={apiRunning}
            className="px-3 py-2 rounded-xl bg-purple-600 text-white shadow hover:shadow-lg hover:-translate-y-0.5 transition disabled:opacity-50"
          >
            {apiRunning ? 'Running API…' : 'Run API'}
          </button>
        </div>

        {(excelWeb || excelApi || lastRunSummary) && (
          <div className="mt-3 text-sm">
            {lastRunSummary && (
              <div className="mb-1">
                Passed: <b className="text-emerald-600">{lastRunSummary.passed}</b> •
                {' '}Failed: <b className="text-rose-600">{lastRunSummary.failed}</b> •
                {' '}Total: <b>{lastRunSummary.total}</b>
              </div>
            )}
            {excelWeb && (
              <div>Web Issues:
                {' '}<a className="text-blue-600 underline hover:text-blue-700 hover:underline-offset-4 transition"
                      href={`http://localhost:4000${excelWeb}`} target="_blank" rel="noreferrer">
                      Download Issues.xlsx
                    </a>
              </div>
            )}
            {excelApi && (
              <div>API Issues:
                {' '}<a className="text-blue-600 underline hover:text-blue-700 hover:underline-offset-4 transition"
                      href={`http://localhost:4000${excelApi}`} target="_blank" rel="noreferrer">
                      Download API_Issues.xlsx
                    </a>
              </div>
            )}
          </div>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.14 }}
        className="bg-white rounded-2xl p-5 shadow"
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold">Run History</h3>
          <span className="text-xs text-gray-500">Showing latest {Math.min(10, runs.length)} runs</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Run</th>
                <th>Passed</th>
                <th>Failed</th>
                <th>Total</th>
                <th>Started</th>
                <th>Artifacts</th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(0,10).map(r => (
                <tr key={r.runId} className="border-b hover:bg-gray-50 transition">
                  <td className="py-2">{r.runId}</td>
                  <td className="text-emerald-600">{r.passed}</td>
                  <td className="text-rose-600">{r.failed}</td>
                  <td>{r.total}</td>
                  <td>{new Date(r.startedAt).toLocaleString()}</td>
                  <td className="whitespace-nowrap">
                    <a className="text-blue-600 underline hover:text-blue-700 hover:underline-offset-4 transition mr-2"
                       href={`http://localhost:4000${r.excelPath}`} target="_blank" rel="noreferrer">
                      Issues.xlsx
                    </a>
                    <a className="text-blue-600 underline hover:text-blue-700 hover:underline-offset-4 transition"
                       href={`http://localhost:4000${r.runDir}`} target="_blank" rel="noreferrer">
                      Folder
                    </a>
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr><td colSpan={6} className="py-3 text-sm text-gray-500">No runs yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.17 }}
        className="bg-white rounded-2xl p-5 shadow"
      >
        <h3 className="font-semibold mb-1">Share (Viewer link)</h3>
        <p className="text-sm text-gray-600">
          When you created the project, the server returned a viewer link (e.g. <code>/viewer/TOKEN</code>).  
          Share it as <code>http://localhost:5173/viewer/TOKEN</code>. Viewer mode is read-only.
        </p>
      </motion.div>
    </div>
  )
}
