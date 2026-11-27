import { notesRoutes } from './features/notes/notes.routes';
import { adminRoutes } from './features/admin/admin.routes';
import type { RouteObject } from 'react-router'
import { AppLayout } from './layouts/app-layout'
import { HomePage } from './pages/home.page'
import { AboutPage } from './pages/about.page'
import { NotFoundPage } from './pages/not-found.page'
import { authRoutes } from './features/auth/auth.routes'
import { SharePhotoPage } from './features/photos/share.page'
import { ReportSomeonePage } from './features/public-reports/report-someone.page'

export const routes: RouteObject[] = [
  ...adminRoutes,
  {
    element: <AppLayout />,
    children: [
      ...notesRoutes,
      { path: '/', element: <HomePage /> },
      { path: '/about', element: <AboutPage /> },
      { path: '/share', element: <SharePhotoPage /> },
      { path: '/report-someone', element: <ReportSomeonePage /> },
      ...authRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
