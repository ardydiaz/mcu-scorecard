import api from './axios';

// q searches name/email; role and status ('active' | 'inactive') filter. Returns { data, total, page, limit }
export async function getUsers({ page = 1, limit = 50, q, role, status } = {}) {
  const { data } = await api.get('/users', {
    params: { page, limit, q: q || undefined, role: role || undefined, status: status || undefined },
  });
  return data;
}

export async function getUser(id) {
  const { data } = await api.get(`/users/${id}`);
  return data;
}

export async function updateUser(id, changes) {
  const { data } = await api.patch(`/users/${id}`, changes);
  return data;
}

export async function setUserDepartments(id, departmentIds) {
  const { data } = await api.put(`/users/${id}/departments`, { departmentIds });
  return data;
}

export async function syncUsers() {
  const { data } = await api.post('/users/sync');
  return data;
}
