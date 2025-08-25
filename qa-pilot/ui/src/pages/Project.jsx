import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../api'

export default function Project() {
  const { id } = useParams()
  const [project,setProject] = useState(null)
  const [prdId,setPrdId] = useState(null)
  const [tests,setTests] = useState([])
  const [runs,setRuns] = useState([])

  useEffect(()=>{ api.get(`/projects/${id}`).then(r=>setProject(r.data)) },[id])
  useEffect(()=>{ api.get(`/projects/${id}/runs`).then(r=>setRuns(r.data)) },[id])

  async function uploadPRD(e) {
    const f=e.target.files[0]; if(!f)return;
    const form=new FormData(); form.append('file',f);
    const r=await api.post(`/projects/${id}/upload-prd`,form)
    setPrdId(r.data.prdId)
  }

  async function generateTests() {
    const r=await api.post(`/projects/${id}/generate-tests`,{prdId,baseUrl:''})
    setTests(r.data.tests||[])
  }

  async function runTests() {
    const r=await api.post(`/projects/${id}/run-web`,{tests})
    alert(`Total:${r.data.total} Passed:${r.data.passed} Failed:${r.data.failed}`)
    setRuns([r.data,...runs])
  }

  return (
    <div>
      <h1 className="text-xl font-bold">{project?.name}</h1>
      <input type="file" onChange={uploadPRD} className="mt-2"/>
      {prdId && <button onClick={generateTests} className="ml-2 bg-indigo-600 text-white px-2 py-1">Generate Tests</button>}
      {tests.length>0 && <button onClick={runTests} className="ml-2 bg-green-600 text-white px-2 py-1">Run</button>}
      <pre className="mt-4 bg-slate-100 p-2 text-sm">{JSON.stringify(tests,null,2)}</pre>
      <h2 className="mt-6 font-bold">Runs</h2>
      <ul>{runs.map(r=><li key={r.runId}>{new Date(r.startedAt).toLocaleString()} → {r.passed}/{r.total}</li>)}</ul>
    </div>
  )
}
