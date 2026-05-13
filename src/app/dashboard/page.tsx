import { redirect } from 'next/navigation';

// Dashboard home — redirect to the Forms page as the default landing view.
export default function DashboardPage() {
  redirect('/dashboard/forms');
}
