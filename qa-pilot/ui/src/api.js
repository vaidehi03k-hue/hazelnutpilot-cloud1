// qa-pilot/ui/src/api.js
import axios from "axios";

export const API_BASE =
  (import.meta.env && import.meta.env.VITE_API_BASE_URL) || "/api";

export const api = axios.create({ baseURL: API_BASE });

// helper for files served by the server (screenshots, xlsx, run folders, etc.)
export const assetUrl = (p = "") =>
  p?.startsWith("http") ? p : `${window.location.origin}${p}`;
