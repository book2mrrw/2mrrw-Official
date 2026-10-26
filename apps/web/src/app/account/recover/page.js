'use client';
import OwnershipRecoveryForm from '@/components/account/OwnershipRecoveryForm';
import { useAuth } from '@/context/AuthContext';
export default function OwnershipRecoveryPage() {
  const { refreshAccountState } = useAuth();
  return <main style={{ maxWidth: 640, margin: '40px auto', padding: 20 }}><h1>Recover your purchases</h1>
    <OwnershipRecoveryForm onComplete={() => refreshAccountState({ force: true, reason: 'purchase:completed', source: 'ownership-recovery' })} />
  </main>;
}
