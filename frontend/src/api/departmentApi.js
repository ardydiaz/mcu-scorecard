import api from './axios';

// Admin-only: departments with their matching settings and linked user counts
export async function getDepartments() {
  const { data } = await api.get('/departments');
  return data;
}

// department: { code, name, description, aliases[], otherNames[], viewAll, leadCodes[] }
export async function createDepartment(department) {
  const { data } = await api.post('/departments', department);
  return data;
}

export async function updateDepartment(id, department) {
  const { data } = await api.put(`/departments/${id}`, department);
  return data;
}

// Soft delete: the department stops matching users but keeps its settings and links
export async function deleteDepartment(id) {
  const { data } = await api.delete(`/departments/${id}`);
  return data;
}

export async function restoreDepartment(id) {
  const { data } = await api.post(`/departments/${id}/restore`);
  return data;
}
