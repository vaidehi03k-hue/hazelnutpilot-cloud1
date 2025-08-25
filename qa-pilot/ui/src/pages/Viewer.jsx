import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../api'

export default function Viewer() {
  const { token } = useParams()
  const [data,setData]=useState(null)
  useEffect(()=>{ api.get(`/viewer/${token}`).then(r=>setData(r.data)) },[token])
  if(!data)return <div>Loading…</div>
  return (
    <div>
      <h1>{data.project.name}</h1>
      <ul>{data.runs.map(r=><li key={r.id}>{new Date(r.startedAt).toLocaleString()} → {r.passed}/{r.total}</li>)}</ul>
    </div>
  )
}
