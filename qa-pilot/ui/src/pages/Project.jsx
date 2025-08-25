// qa-pilot/ui/src/pages/Project.jsx
import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, assetUrl } from '../api'

export default function Project(){
  const { id } = useParams()
  const [project, setProject] = useState(null)
  const [prdId, setPrdId] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [tests, setTests] = useState([])
  const [genBusy, setGenBusy] = useState(false)
  const [runBusy, setRunBusy] = useState(false)
  const [runs, setRuns] = useState([])

  async function load(){
    const { data } = await api.get(`/projects/${id}`)
    setProject(data)
    const r = await api.get(`/projects/${id}/runs`)
    setRuns(r.data || [])
  }
  useEffect(()=>{ load() },[id])

  async function onUpload(e){
    const f = e.target.files?.[0]
    if(!f) return
    const fd = new FormData()
    fd.append('file', f)
    const { data } = await api.post(`/projects/${id}/upload-prd`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    setPrdId(data.prdId)
  }

  async function generate(){
    if(!prdId){ alert('Upload PRD first'); return }
    setGenBusy(true)
    try{
      const { data } = await api.post(`/projects/${id}/generate-tests`, { prdId, baseUrl })
      setTests(Array.isArray(data?.tests) ? data.tests : [])
      console.log('Generated tests:', data?.tests?.length || 0, data?.tests)
    } finally {
      setGenBusy(false)
    }
  }

  async function runWeb(){
    if(!tests.length){ alert('Generate tests first'); return }
    setRunBusy(true)
    try{
      const { data } = await api.post(`/projects/${id}/run-web`, { tests })
      await load()
      alert(`Run complete: total ${data.total}, passed ${data.passed}, failed ${data.failed}`)
    } finally {
      setRunBusy(false)
    }
  }

  if(!project) return <div>Loading…</div>

  return (
    <div className="space-y-6">
      <div className="bg-white p-4 rounded shadow">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{project.name}</h2>
          <div className="text-xs text-gray-500">Project ID: {project.id}</div>
        </div>
      </div>

      <div className="bg-white p-4 rounded shadow space-y-3">
        <h3 className="font-semibold">1) Upload PRD (txt/pdf/docx)</h3>
        <input type="file" onChange={onUpload} />
        <div className="text-xs text-gray-600">prdId: {prdId || '(none yet)'}</div>
      </div>

      <div className="bg-white p-4 rounded shadow space-y-3">
        <h3 className="font-semibold">2) Generate tests (AI)</h3>
        <div className="flex gap-2 items-center">
          <label className="text-sm w-24">Base URL:</label>
          <input className="border px-3 py-2 rounded w-96"
            value={baseUrl} onChange={e=>setBaseUrl(e.target.value)}
            placeholder="https://www.saucedemo.com/" />
          <button onClick={generate} disabled={genBusy}
            className="bg-black text-white px-4 py-2 rounded disabled:opacity-50">
              {genBusy ? 'Generating…' : 'Generate tests'}
          </button>
        </div>

        <pre className="bg-gray-100 rounded p-3 text-xs overflow-auto max-h-72">
{JSON.stringify({ tests }, null, 2)}
        </pre>
      </div>

      <div className="bg-white p-4 rounded shadow space-y-3">
        <h3 className="font-semibold">3) Run web tests</h3>
        <button onClick={runWeb} disabled={runBusy || !tests.length}
          className="bg-emerald-600 text-white px-4 py-2 rounded disabled:opacity-50">
          {runBusy ? 'Running…' : 'Run'}
        </button>
      </div>

      <div className="bg-white p-4 rounded shadow space-y-3">
        <h3 className="font-semibold">Recent Runs</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">When</th>
              <th>Total</th>
              <th>Passed</th>
              <th>Failed</th>
              <th>Artifacts</th>
            </tr>
          </thead>
          <tbody>
            {(runs||[]).map(r=>(
              <tr key={r.id} className="border-b">
                <td className="py-2">{new Date(r.startedAt).toLocaleString()}</td>
                <td>{r.total}</td>
                <td className="text-emerald-700">{r.passed}</td>
                <td className="text-rose-700">{r.failed}</td>
                <td className="space-x-2">
                  {r.excelPath && <a className="text-blue-600 underline" href={assetUrl(r.excelPath)} target="_blank" rel="noreferrer">Issues.xlsx</a>}
                  {r.runDir && <a className="text-blue-600 underline" href={assetUrl(r.runDir)} target="_blank" rel="noreferrer">Folder</a>}
                </td>
              </tr>
            ))}
            {(!runs || runs.length===0) && (
              <tr><td colSpan="5" className="text-gray-500 py-3">No runs yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
