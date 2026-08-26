import { useAuthStore } from '../../store/auth-store';

interface Props {
  children: React.ReactNode;
}

export function AuthGuard({ children }: Props) {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  if (!isLoggedIn) return null;
  return <>{children}</>;
}
