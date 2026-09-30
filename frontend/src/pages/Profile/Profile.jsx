import useAuth from '../../hooks/useAuth';
import Card from '../../components/common/Card';
import { capitalize, formatDate, initials } from '../../utils/format';

export default function Profile() {
  const { user } = useAuth();

  const details = [
    ['Email', user.email],
    ['Job title', user.jobTitle || '—'],
    ['Role', capitalize(user.role)],
    ['Status', user.isActive ? 'Active' : 'Disabled'],
    ['Last sign-in', formatDate(user.lastLoginAt)],
  ];

  return (
    <div className="page">
      <h1 className="page__title">Profile</h1>

      <Card>
        <div className="profile">
          <span className="avatar avatar--lg">{initials(user.displayName || user.email)}</span>
          <div>
            <h2 className="profile__name">{user.displayName || user.email}</h2>
            <p className="muted">{user.email}</p>
          </div>
        </div>
        <dl className="details">
          {details.map(([label, value]) => (
            <div key={label} className="details__row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Departments">
        {user.departments?.length ? (
          <ul className="link-list">
            {user.departments.map((d) => (
              <li key={d.id}>
                {d.name}
                {d.UserDepartment?.isHead && <span className="badge">Head</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">You are not assigned to any department yet.</p>
        )}
      </Card>
    </div>
  );
}
