import AdminPage from '@/components/admin/AdminPage';
import AuthGate from '@/components/auth/AuthGate';

export const metadata = { title: 'Administration — BI Advisor' };

export default function Page() {
  return <AuthGate><AdminPage /></AuthGate>;
}
