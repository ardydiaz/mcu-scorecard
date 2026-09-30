import api from './axios';

// Exchanges a Microsoft ID token for our application JWT.
// Returns { user: { id, email, name, department, role }, token }
export async function loginWithMicrosoft(microsoftIdToken) {
  // Body must be {} not null: axios would send the text "null", which Express rejects as invalid JSON
  const { data } = await api.post('/auth/microsoft', {}, {
    headers: { Authorization: `Bearer ${microsoftIdToken}` },
  });
  return data;
}

// Records the sign-out in the audit log (the token itself is discarded by the browser)
export async function logout() {
  await api.post('/auth/logout');
}

export async function getMe() {
  const { data } = await api.get('/auth/me');
  return data;
}
