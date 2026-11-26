# sariel-app

Tilcayo MongoDB API + React/Vite client with authentication and admin pages.

Use Node.js 22.12+ or 24+. Start MongoDB and configure api/.env (MONGODB_URI,
PORT and private auth/mail settings when enabled). Never put secrets in VITE_*.

```sh
npm install
npm run dev
```

The client runs on Vite's printed URL and proxies /api to port 9149. If you change
the API port, set API_PROXY_TARGET for the client dev process or edit
client/vite.config.ts. Visit /notes for sample CRUD, /login to sign in, /register to create an account, /dashboard for your overview and /profile for profile and settings, and /admin for management.
Access tokens stay in memory; an HttpOnly refresh cookie restores the session on reload. Production requires HTTPS and a same-origin API proxy. Configure backend SMTP settings for password recovery.
Provision the admin role through trusted server code; registration never grants it.

Admin users and role filters are at /admin/users. The catalog at /admin/products includes inventory cards and add/edit forms. Product data starts empty; add products in the UI. Protected catalog routes and the Product model are generated in api/src.

Generate both halves from this directory:

```sh
npx tilcayo make:resource Author name:string --fullstack
npx tilcayo make:resource Book title:string author:ref:Author year:number? --fullstack
```

Register backend routes in api/src/app.ts and spread frontend route arrays into
client/src/routes.tsx layout children. For admin resources, add their links in
client/src/features/admin/admin-layout.tsx and nest createBooksRoutes('books',
'/admin/books') in the admin route module. Tenant resource routes require membership and use tenant-scoped models. Add role guards for privileged actions.

Run npm run build to build both halves. Production uses
api/dist/index.js and client/dist; serve the client with SPA fallback and proxy
/api to the API. npm run start starts the API only. Configure HTTPS on your host.
The dev runner requires npm on PATH; npm ships with Node.js even if dependencies
are installed with pnpm or Yarn. Stop both processes with Ctrl+C. Separate
dev:api and dev:client scripts are available.

## Tenant setup

Edit **api/.env in this generated app**. Configure MONGODB_URI and fill the blank TENANCY_SUPERADMIN_EMAIL and TENANCY_SUPERADMIN_PASSWORD fields with your chosen account values. The placeholders are also listed in api/.env.example; editing the example file alone does not configure the app. Keep the generated AUTH_ACCESS_SECRET and AUTH_REFRESH_SECRET.

```sh
# From this app's root, after configuring api/.env
npm run tenancy:setup
npm run dev
```

Setup provisions only the Super Admin. It creates no default tenant and does not migrate records. Re-running setup resets that account's password and revokes its sessions. On later starts, use npm run dev without setup.

Sign in on the main domain, open Tenant administration, then create tenants and assign administrators. Use the frontend port printed by Vite. TENANCY_BASE_DOMAIN defaults to localhost; production needs wildcard DNS, HTTPS and a same-origin Host-preserving API proxy. Workspace sessions are host-only and tenant roles belong to memberships.
