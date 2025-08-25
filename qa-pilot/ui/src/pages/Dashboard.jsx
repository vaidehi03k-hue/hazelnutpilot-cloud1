// qa-pilot/ui/src/pages/Dashboard.jsx
import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'

export default function Dashboard(){
  const [projects, setProjects] = useState([])
  const [name, setName] = useState('My Project')
  const nav = useNavigate()

  async function load(){
    const { data } = await api.get('/projects')
    setProjects(data || [])
  }
  useEffect(()=>{ load() },[])

  async function create(){
    const { data } = await api.post('/projects', { name })
    nav(`/project/${data.id}`)
  }

  return (
    <div className="space-y-6">
      <div className="bg-white p-4 rounded shadow">
        <h2 className="text-lg font-semibold mb-2">Create Project</h2>
        <div className="flex gap-2">
          <input className="border px-3 py-2 rounded w-72"
                 value={name} onChange={e=>setName(e.target.value)} />
          <button onClick={create}
                  className="bg-black text-white px-4 py-2 rounded">Create</button>
        </div>
      </div>

      <div className="bg-white p-4 rounded shadow">
        <h2 className="text-lg font-semibold mb-3">Projects</h2>
        <ul className="space-y-2">
          {projects.map(p=>(
            <li key={p.id} className="flex items-center justify-between border rounded px-3 py-2">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-gray-500">ID: {p.id}</div>
              </div>
              <Link to={`/project/${p.id}`} className="text-blue-600 underline">Open</Link>
            </li>
          ))}
          {projects.length === 0 && <div className="text-sm text-gray-500">No projects yet.</div>}
        </ul>
      </div>
    </div>
  )
}
