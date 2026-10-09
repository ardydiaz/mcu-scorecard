# MCU Scorecard

## Running locally

Start both apps in separate terminals, then open http://localhost:6001.

```bash
cd backend && npm run dev    # API on http://localhost:5005
cd frontend && npm run dev   # UI on http://localhost:6001
```

## Frontend

React 19 + Vite + React Router + MSAL (`@azure/msal-browser`). Settings live in `frontend/.env`: `VITE_API_URL`, `VITE_AZURE_CLIENT_ID`, `VITE_AZURE_TENANT_ID` (the last two are public identifiers, not secrets).

### Microsoft 365 sign-in flow

1. The Login page calls MSAL, which redirects to Microsoft Entra ID.
2. Microsoft returns an **ID token** to React.
3. React calls `POST /api/auth/microsoft` with `Authorization: Bearer <ID token>`.
4. The backend validates the token against Microsoft's signing keys: signature, issuer (MCU tenant only), audience (this app), and expiry.
5. The backend reads the user's department from Microsoft Graph, finds or creates the user and department in MySQL, and returns:
   ```json
   {
     "user": { "id": 15, "email": "user@mcu.edu.ph", "name": "Juan Dela Cruz", "department": "ITD", "role": "user" },
     "token": "<application JWT>"
   }
   ```
6. React stores the application JWT and sends it as `Authorization: Bearer` on every other API call.

If the user already has a Microsoft session in the tab, clicking "Sign in" gets a fresh ID token silently without a redirect. "Sign out" clears the app session and signs out of Microsoft.

| Page | Route |
| --- | --- |
| Login | `/login` |
| Dashboard | `/dashboard` |
| Strategy Map | `/strategy-map`: objectives grouped by the sheet's "Perspective" column |
| Profile | `/profile` |

## Backend

Node.js + Express API with MySQL (Sequelize) and Microsoft Entra ID sign-in via Microsoft Graph.

### Setup

```bash
cd backend
npm install
cp .env.example .env   # then fill in the values
npm run dev            # http://localhost:5005
```

Requirements: Node.js 20+, a MySQL database, and an Entra ID app registration.

### Database migrations

| Command | What it does |
|---|---|
| `npm run migrate` | Applies pending database changes: adds new columns, creates missing tables and indexes, removes replaced indexes, fills the departments table the first time. Safe to run again. |
| `npm run migrate:check` | Only reports what is missing (changes nothing); exits with code 1 when a migration is pending. |

In development (`npm run dev`) the server migrates automatically when it starts. With `NODE_ENV=production`
it does **not**: it checks the database and refuses to start if a migration is pending. `AUTO_MIGRATE=true|false`
in `.env` overrides either default.

Deploying a new version to production:

```bash
cd backend
npm install --omit=dev
npm run migrate          # back up the database first; the DB user needs CREATE, ALTER and INDEX
npm start                # or restart the PM2 / Windows service
```

### Entra ID app registration

1. Azure Portal → **Microsoft Entra ID → App registrations → New registration**.
2. **Authentication** → add a platform → **Single-page application** → redirect URI `http://localhost:6001` (no trailing slash).
3. **Certificates & secrets** → create a client secret → `AZURE_CLIENT_SECRET` (backend only; used for Graph calls).
4. Copy the **Application (client) ID** and **Directory (tenant) ID** into `backend/.env` and `frontend/.env`.
5. **API permissions** → Microsoft Graph:
   - Delegated: `User.Read` (sign-in, profile photo)
   - Application: `User.Read.All` (department lookup at sign-in)
   - Application: `Sites.Selected` (Excel). The backend **writes** to the workbooks (cells, columns, formatting),
     so read-only permissions are not enough. Do **not** use `Files.ReadWrite.All` or `Sites.ReadWrite.All`:
     those let the app change every file in the tenant. `Sites.Selected` gives no access until step 6.
   - Grant admin consent.
6. **Give the app write access to the scorecard site only.** `Sites.Selected` starts with access to nothing; a
   SharePoint admin grants it the one site that holds the scorecard files. With PnP PowerShell:

   ```powershell
   Connect-PnPOnline -Url https://<tenant>.sharepoint.com/sites/<site> -Interactive -ClientId <your PnP app id>
   Grant-PnPAzureADAppSitePermission -AppId <AZURE_CLIENT_ID> -DisplayName "MCU Scorecard" `
     -Site https://<tenant>.sharepoint.com/sites/<site> -Permissions Write
   ```

   Or with Graph Explorer, signed in as an admin (needs `Sites.FullControl.All`):

   ```http
   GET  https://graph.microsoft.com/v1.0/sites/<tenant>.sharepoint.com:/sites/<site>      → copy "id"
   POST https://graph.microsoft.com/v1.0/sites/<site id>/permissions
   { "roles": ["write"],
     "grantedToIdentities": [{ "application": { "id": "<AZURE_CLIENT_ID>", "displayName": "MCU Scorecard" } }] }
   ```

   Check it with `GET https://graph.microsoft.com/v1.0/sites/<site id>/permissions`. If the app later gets
   `403 accessDenied` from Excel, the files are on a different site than the one granted.

### Production (Linux, behind nginx)

The API listens on `HOST=127.0.0.1` by default, so only nginx on the same server can reach it; keep port
5005 closed in the firewall as well. nginx must pass the visitor's address so audit logs record the real IP
(the API trusts `X-Forwarded-For` only from `TRUST_PROXY`, by default `loopback`):

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:5005;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

If nginx runs on a different machine, set `HOST=0.0.0.0` (or the server's private IP), set `TRUST_PROXY` to the
nginx server's IP, and allow port 5005 only from that IP in the firewall.

### API

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/health` | public |
| POST | `/api/auth/microsoft` | `Bearer <Microsoft ID token>`: returns `{ user, token }` |
| GET | `/api/auth/me` | signed in |
| GET | `/api/users` | admin, manager |
| GET | `/api/users/:id` | self, admin, manager |
| PATCH | `/api/users/:id` | admin (`role`, `isActive`) |
| PUT | `/api/users/:id/departments` | admin (`departmentIds`) |
| GET | `/api/strategy/sheets` | signed in |
| GET | `/api/strategy/sheets/:sheet` | signed in |

Send `Authorization: Bearer <token>` on protected routes.
