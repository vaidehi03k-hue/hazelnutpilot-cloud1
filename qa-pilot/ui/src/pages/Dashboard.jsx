import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'

export default function Dashboard() {
  const [projects,setProjects] = useState([])
  useEffect(()=>{ api.get('/projects').then(r=>setProjects(r.data)) },[])

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Projects</h1>
      <Link to="/project/new" className="px-3 py-2 bg-indigo-600 text-white rounded">+ New Project</Link>
      <ul className="mt-4 space-y-2">
        {projects.map(p=>
          <li key={p.id}>
            <Link to={`/project/${p.id}`} className="text-blue-600">{p.name}</Link>
          </li>)}
      </ul>
    </div>
  )
}
