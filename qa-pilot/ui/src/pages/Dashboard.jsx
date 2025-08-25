import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import UICard from '../components/UICard'

const PIE_COLORS = ['#22c55e','#ef4444','#f59e0b']

export default function Dashboard(){
  const [projects, setProjects] = useState([])
  const [summary, setSummary] = useState({ total:0, passed:0, failed:0, runs:[] })
  const [newName, setNewName] = useState('My Project')

  useEffect(()=>{
    (async ()=>{
      const ps = await api.get('/projects'); setProjects(ps.data)
      const sum = await api.get('/summary'); setSummary(sum.data)
    })()
  },[])

  async function createProject(){
    const { data } = await api.post('/projects', { name: newName })
    const ps = await api.get('/projects'); setProjects(ps.data)
    alert(`Viewer link: ${data.viewerLink}`)
  }

  const pieData = [
    { name: 'Passed', value: summary.passed||0 },
    { name: 'Failed', value: summary.failed||0 },
    { name: 'Others', value: Math.max(0,(summary.total||0)-(summary.passed||0)-(summary.failed||0)) },
  ]
  const barData = (summary.runs||[]).slice(-6).map(r => ({
    name: r.runId?.slice(-5) || 'run',
    Passed: r.passed, Failed: r.failed
  }))

  return (
    <div className="grid gap-6">
      <div className="rounded-2xl p-4 bg-white/70 backdrop-blur-xs border shadow">
        <div className="flex flex-col sm:flex-row justify-between items-start gap-2">
          <h1 className="text-xl font-semibold">QA Pilot</h1>
          <p className="text-xs text-slate-500">Built by <b>Vaidehi Kulkarni</b> for Mosaic Buildathon</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <UICard title="Total Tests" value={summary.total||0} accent="indigo" />
        <UICard title="Passed" value={summary.passed||0} accent="emerald" />
        <UICard title="Failed" value={summary.failed||0} accent="rose" />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <UICard title="Pass/Fail" accent="indigo">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={100} label>
                  {pieData.map((e, i) => <Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </UICard>

        <UICard title="Recent Runs" accent="emerald">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="Passed" fill="#22c55e" />
                <Bar dataKey="Failed" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </UICard>
      </div>

      <UICard accent="indigo">
        <div className="flex items-center gap-3">
          <input value={newName} onChange={e=>setNewName(e.target.value)}
                 className="border rounded-xl px-3 py-2 w-72 focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
          <button onClick={createProject}
                  className="px-4 py-2 rounded-xl bg-blue-600 text-white shadow hover:shadow-lg hover:-translate-y-0.5 transition">
            + New Project
          </button>
        </div>
      </UICard>

      <UICard title="Projects" accent="indigo">
        <ul className="divide-y">
          {projects.map(p => (
            <li key={p.id}
                className="py-3 flex justify-between items-center hover:bg-slate-50 rounded-xl px-2 transition">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-sm text-slate-500">{(p.runs||[]).length} runs</div>
              </div>
              <Link to={`/project/${p.id}`} className="text-indigo-600 hover:text-indigo-700 transition">
                Open →
              </Link>
            </li>
          ))}
          {projects.length === 0 && <li className="py-3 text-sm text-slate-500">No projects yet.</li>}
        </ul>
      </UICard>
    </div>
  )
}
