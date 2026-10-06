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

Requirements: Node.js 20+, a MySQL database (tables are created on startup), and an Entra ID app registration.

### Entra ID app registration

1. Azure Portal → **Microsoft Entra ID → App registrations → New registration**.
2. **Authentication** → add a platform → **Single-page application** → redirect URI `http://localhost:6001` (no trailing slash).
3. **Certificates & secrets** → create a client secret → `AZURE_CLIENT_SECRET` (backend only; used for Graph calls).
4. Copy the **Application (client) ID** and **Directory (tenant) ID** into `backend/.env` and `frontend/.env`.
5. **API permissions** → Microsoft Graph:
   - Delegated: `User.Read` (sign-in)
   - Application: `User.Read.All` (department lookup at sign-in, user sync), `Files.Read.All` or `Sites.Read.All` (Excel)
   - Grant admin consent.

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
