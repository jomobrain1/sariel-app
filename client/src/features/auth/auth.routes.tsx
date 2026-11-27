import { InvitationPage } from '../administration/workforce';
import type { RouteObject } from 'react-router'
import { AuthLayout } from '../../layouts/auth-layout'
import { RequireAuth, GuestOnly } from '../../middleware/auth'
import { LoginPage } from '../../pages/login.page'
import { RegisterPage } from '../../pages/register.page'
import { ForgotPasswordPage } from '../../pages/forgot-password.page'
import { DashboardPage } from '../../pages/dashboard.page'
import { ProfilePage } from '../../pages/profile.page'
import { ForbiddenPage } from '../../pages/forbidden.page'
import { CirclePage } from '../circle/circle.page'
import { NotificationsPage } from '../notifications/notifications.page'
import { PhotosPage } from '../photos/photos.page'

export const authRoutes: RouteObject[] = [
  { element: <GuestOnly />, children: [{ element: <AuthLayout />, children: [
    { path: '/login', element: <LoginPage /> },
    { path: '/register', element: <RegisterPage /> },
    { path: '/forgot-password', element: <ForgotPasswordPage /> },
  ] }] },
  { element: <RequireAuth />, children: [
    { path: '/staff/invitation', element: <InvitationPage /> },
    { path: '/dashboard', element: <DashboardPage /> },
    { path: '/profile', element: <ProfilePage /> },
    { path: '/circle', element: <CirclePage /> },
    { path: '/notifications', element: <NotificationsPage /> },
    { path: '/photos', element: <PhotosPage /> },
  ] },
  { path: '/forbidden', element: <ForbiddenPage /> },
]
