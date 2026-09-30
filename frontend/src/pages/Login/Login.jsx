import { Navigate, useLocation } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';
import Loader from '../../components/common/Loader';
import ErrorMessage from '../../components/common/ErrorMessage';

export default function Login() {
  const { user, loading, signingIn, error, login } = useAuth();
  const location = useLocation();
  const returnTo = location.state?.from?.pathname || '/dashboard';

  if (loading) return <Loader fullScreen label="Signing you in…" />;
  if (user) return <Navigate to={returnTo} replace />;

  return (
    <div className="login">
      <div className="login__card">
        <img src="/favicon.svg" alt="" width="56" height="56" />
        <h1>MCU Scorecard</h1>
        <p className="muted">Sign in with your MCU Microsoft 365 account to continue.</p>
        <ErrorMessage>{error}</ErrorMessage>
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={() => login(returnTo)}
          disabled={signingIn}
        >
          {signingIn ? 'Signing in…' : 'Sign in with Microsoft'}
        </button>
      </div>
    </div>
  );
}
