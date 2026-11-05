import { createFileRoute } from '@tanstack/react-router';

// The customer entry. It sits outside the staff layout, so it needs no sign-in
// and does not download staff code.
export const Route = createFileRoute('/order/$tableToken')({ component: CustomerOrderPage });

function CustomerOrderPage() {
  return (
    <main className="page">
      <p className="empty-note">掃碼點餐即將開放，請洽現場人員。</p>
    </main>
  );
}
