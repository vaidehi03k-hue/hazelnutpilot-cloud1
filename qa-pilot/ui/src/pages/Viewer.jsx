// qa-pilot/ui/src/pages/Viewer.jsx
import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, assetUrl } from '../api'

export default function Viewer(){
  const { token } = useParams()
  const [data, setData] = useState(null)

  async function load(){
    try{
      const { data } = await api.get(`/viewer/${token}`)
      setData(data)
    }catch(e){
      setData({ error: e?.response?.data?.error || 'Invalid link' })
    }
  }
  useEffect(()=>{ load() },[token])

  if(!data) return <div>Loading…</div>
  if(data.error) return <div className="text-rose-700">{data.error}</div>

  const { project, runs } = data
  return (
    <div className="space-y-6">
      <div className="bg-white p-4 rounded shadow">
        <h2 className="text-lg font-semibold">Viewer: {project?.name}</h2>
      </div>
      <div className="bg-white p-4 rounded shadow">
        <table className="w-full text-sm">
          <thead><tr className="text-left border-b">
            <th className="py-2">When</th><th>Total</th><th>Passed</th><th>Failed</th><th>Artifacts</th>
          </tr></thead>
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
