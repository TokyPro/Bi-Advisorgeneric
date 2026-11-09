import AppShell from '@/components/layout/AppShell';
import AuthGate from '@/components/auth/AuthGate';

export default function Page() {
  return <AuthGate><AppShell /></AuthGate>;
}
