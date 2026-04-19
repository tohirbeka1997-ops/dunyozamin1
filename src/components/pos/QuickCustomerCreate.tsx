import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { goToCreateCustomer } from '@/utils/customerNavigation';

/**
 * POS button should navigate to the same create-customer page as Customers section.
 * CustomerForm supports `?from=pos` and returns back to POS after save.
 */
export default function QuickCustomerCreate() {
  const navigate = useNavigate();

  return (
    <Button
      variant="outline"
      size="icon"
      className="shrink-0"
      onClick={() => goToCreateCustomer(navigate, 'pos')}
      title="Yangi mijoz qo'shish"
    >
      <Plus className="h-4 w-4" />
    </Button>
  );
}
