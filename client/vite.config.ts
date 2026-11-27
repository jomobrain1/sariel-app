import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// API_PROXY_TARGET (in client/.env.local) picks the API for local development: the deployed one,
// e.g. https://sariel.vercel.app, or a local `npm run dev:api` at http://127.0.0.1:9149 (the fallback).
export default defineConfig(({ mode }) => {
  const target = process.env.API_PROXY_TARGET || loadEnv(mode, process.cwd(), '').API_PROXY_TARGET || 'http://127.0.0.1:9149';
  const remote = !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(target);
  return {
    plugins: [react()],
    resolve: { dedupe: ['react', 'react-dom', 'react-redux', '@reduxjs/toolkit', 'react-router'] },
    // A remote API needs its own Host header; a local one keeps ours so *.localhost workspaces still resolve.
    server: { host: '127.0.0.1', allowedHosts: ['.localhost'], proxy: { '/api': { target, changeOrigin: remote, secure: true } } },
  };
});
