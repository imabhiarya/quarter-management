# AWAS — Govt Married Accommodation Management System

A lightweight web application for managing government married accommodation: the quarter register, applications, the waiting list, allotments, vacations, the allotment committee, and reports.

## Stack

| Layer    | Technology |
|----------|------------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, React Router, Lucide icons |
| Backend  | Hono on Node.js, the built-in `node:sqlite` database (no native build step) |
| Auth     | JWT (HS256) with scrypt-hashed passwords and role-based access |

There is no Docker setup. You only need **Node.js 22.13 or later** (Node 24 recommended).

## Getting started

```bash
npm install
npm run dev          # API on :3001, web app on http://localhost:5173
```

On the first run the database (`data/gmaams.db`) is created and filled with sample data.

| User        | Password   | Role             | Access |
|-------------|------------|------------------|--------|
| `admin`     | admin123   | Administrator    | Everything, including Settings |
| `bso_accom` | clerk123   | Dealing Clerk    | All registers and workflows |
| `member1`   | member123  | Committee Member | Read-only |

**Change these passwords before real use.** You can do this under Settings → User Management, or from the user menu → Change password.

## Production

```bash
npm run build        # type-check and build the front end into dist/
npm start            # serves the API and the built app on http://localhost:3001
```

| Environment variable | Default        | Purpose |
|----------------------|----------------|---------|
| `PORT`               | `3001`         | HTTP port |
| `DATA_DIR`           | `./data`       | Holds the database, uploaded documents and the JWT secret |
| `JWT_SECRET`         | auto-generated | Signing key (otherwise saved to `data/.jwt-secret`) |

To back up, copy the `data/` directory. `npm run seed` **wipes** the data and reloads the sample data.

## Modules

- **Dashboard**: key figures, recent applications, the next committee meeting, the monthly allotment funnel and quick actions.
- **Quarter Register**: the master register, with CSV import and a printable register.
- **Vacation Report**: monthly vacations. Recording a vacation marks the quarter vacant and closes the allotment.
- **New Application / Applicant Register**: the full application form with document uploads (PDF/JPG/PNG, up to 5 MB), editing and status changes.
- **Waiting List**: applicants waiting for a quarter, with waiting days, seniority reordering and the next quarter due.
- **Quarter Allotment / Allotment Orders**: allots a vacant quarter to an eligible applicant, marks the quarter occupied, and prints the order letter. Cancelling an allotment reverses this.
- **Allotment Committee, Meeting Schedule, Meeting Agenda, Proceedings**: committee work, with printable proceedings.
- **Retention / Extension**: approving a case extends the quarter's vacation due date.
- **Reports & Returns**: eight reports, each of which can be exported (CSV that opens in Excel) or printed.
- **Settings**: users (add/edit/delete/reset password), master data lists, and system configuration (letterhead and allotment tenure).

Reference numbers are generated automatically, e.g. `GMAA/APP/2026/0001`, `AO/001/2026`, `ACM/01/2026`, `PROC/01/2026`.

## Project layout

```
server/   index.ts (routes) · logic.ts (validation and workflow rules) · stats.ts · reports.ts · db.ts · auth.ts · seed.ts
src/      App.tsx · modules.tsx (per-screen configuration) · components/ · pages/ · lib/
```

Most register screens are defined declaratively in `src/modules.tsx` (filters, columns, form fields and actions) and rendered by the shared `CrudPage` component. To add a field or filter, you usually only need to edit that file.
