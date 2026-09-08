/**
 * Observation Bot Page
 * 
 * Admin page for viewing system observations and insights.
 * Accessible from: More → Observation Bot
 */

import AdminLayout from '@/components/layout/AdminLayout';
import ObservationBotPanel from '@/components/admin/ObservationBotPanel';

export default function ObservationBotPage() {
  return (
    <AdminLayout title="Observation Bot">
      <ObservationBotPanel />
    </AdminLayout>
  );
}
