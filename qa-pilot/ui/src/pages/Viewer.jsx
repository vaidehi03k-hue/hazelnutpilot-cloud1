import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../api'

export default function Viewer(){
  const { token } = useParams()
  const [data, setData] = useState(null)

  useEffect(()=>{
    (async ()=>{
      const r = await api.get(`/viewer/${token}`)
      setData(r.data)
    })()
  },[token])

  if (!data) return <div>Loading…</div>
  return (
    <div className="grid gap-4">
      <div className="rounded-2xl p-4 bg-white/70 backdrop-blur-xs border shadow">
        <h2 className="text-2xl font-bold">{data.project.name} (Viewer)</h2>
        <p className="text-xs text-slate-500">Built by Vaidehi Kulkarni for Mosaic Buildathon</p>
      </div>
      <div className="bg-white rounded-2xl p-4 shadow">
        <table className="w-full text-sm">
          <thead><tr className="text-left border-b"><th className="py-1">Run</th><th>Passed</th><th>Failed</th><th>Total</th><th>Started</th><th>Artifacts</th></tr></thead>
          <tbody>
            {data.runs.slice(0,20).map(r => (
              <tr key={r.runId} className="border-b hover:bg-gray-50 transition">
                <td className="py-1">{r.runId}</td>
                <td className="text-emerald-600">{r.passed}</td>
                <td className="text-rose-600">{r.failed}</td>
                <td>{r.total}</td>
                <td>{new Date(r.startedAt).toLocaleString()}</td>
                <td><a className="text-blue-600" href={`http://localhost:4000${r.excelPath}`} target="_blank">Issues.xlsx</a> · <a className="text-blue-600" href={`http://localhost:4000${r.runDir}`} target="_blank">Folder</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
