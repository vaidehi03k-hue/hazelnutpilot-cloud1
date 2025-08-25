import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import Dashboard from './pages/Dashboard.jsx'
import Project from './pages/Project.jsx'
import Viewer from './pages/Viewer.jsx'

function Shell() {
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-40 bg-gradient-to-r from-violet-600 via-indigo-600 to-sky-600 text-white shadow">
  <div className="mx-auto max-w-6xl px-4 py-3 flex justify-between items-center">
    <Link to="/" className="flex items-center gap-2 hover:opacity-90 transition">
      <img src="/hazelnut.svg" alt="Hazelnut" className="w-6 h-6" />
      <span className="font-bold text-xl tracking-tight">Hazelnut AI</span> {/* <- change text here */}
    </Link>
    <nav className="flex gap-5 text-white/90">
      <Link to="/" className="hover:text-white transition">Dashboard</Link>
    </nav>
  </div>
</header>


      <main className="mx-auto max-w-6xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/project/:id" element={<Project />} />
          <Route path="/viewer/:token" element={<Viewer />} />
        </Routes>
      </main>

      <footer className="mt-10 py-6 text-center text-xs text-slate-500">
        Built by <b>Vaidehi Kulkarni</b> for Mosaic Buildathon
      </footer>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter><Shell/></BrowserRouter>
)
