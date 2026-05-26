import { Navigate } from 'react-router';

export default function RootIndexRoute() {
  return <Navigate replace to="/cockpit" />;
}
