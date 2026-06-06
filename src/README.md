# RCC HRIS Portal — the code

This folder holds the actual app code. You don't need to edit anything here — Claude does. This is just so you (and any IT person later) know what's what.

## The files
| File | What it is |
|---|---|
| `index.html` | The page layout (sidebar, screens) — based on the Visual Mockup. |
| `app.js` | The brains — login, all the modules (Dashboard, Employees, Worksites, Manning, Pre-hire, Onboarding, Exit Clearance), and the live connection to the database. |
| `config.js` | The database address + public key (safe to share — the real data is protected by login). |
| `deploy.sh` | One command that rebuilds the app and publishes it. |
| `server.js` | A tiny local preview server (used only during development). |

## Where everything lives (nothing is lost)
1. **This Dropbox folder** — syncs across both your Macs.
2. **GitHub** (`agenovi/rcc-hris-portal`) — the published app **and** a backup of this source under `/src` (full version history).
3. **Supabase** (project `jtfkpmvievetihhfdmqb`) — all the employee/branch/pre-hire/etc. data, protected by login.

## How to SEE the app (easiest way)
Double-click **`RCC HRIS Portal - LIVE APP.html`** in the parent folder. It opens the real, working app in your browser. Sign in with your HR login. It auto-updates whenever Claude changes something (Dropbox syncs it).

Or open the web link: **https://agenovi.github.io/rcc-hris-portal/**

## How updates work
Claude edits the files here → runs `deploy.sh` → the web link, the local `LIVE APP.html`, and the GitHub backup all refresh within a minute.
