import { SessionPresentation } from './components/session-presentation'
import { RefreshProgress } from './components/refresh-progress'
import './components/page-loading.css'
import { BrowserRouter, useRoutes } from 'react-router'
import { routes } from './routes'
import { AuthBootstrap } from './app/auth'
import './App.css'
import { Toaster } from './components/toaster'

function AppRoutes() {
  return useRoutes(routes)
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthBootstrap fallback={<AppRoutes />}>
        <AppRoutes />
      </AuthBootstrap>
      <SessionPresentation />
      <RefreshProgress />
      <Toaster />
    </BrowserRouter>
  )
}
