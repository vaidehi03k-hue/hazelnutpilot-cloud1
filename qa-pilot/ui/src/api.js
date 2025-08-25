// qa-pilot/ui/src/api.js
import axios from "axios";

// Render sets VITE_API_BASE_URL=/api in Dockerfile; local dev can override.
const BASE = import.meta.env.VITE_API_BASE_URL || "/api";

export const api = axios.create({ baseURL: BASE });

// server exposes /runs as static; just pass through
export const assetUrl = (p = "") => p;
