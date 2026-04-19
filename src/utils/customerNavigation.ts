import { NavigateFunction } from 'react-router-dom';

/**
 * Navigate to create customer page
 * @param navigate - React Router navigate function
 * @param from - Source of navigation ('pos' or 'customers')
 */
export function goToCreateCustomer(
  navigate: NavigateFunction,
  from?: 'pos' | 'customers'
): void {
  if (from === 'pos') {
    navigate('/customers/new?from=pos');
  } else {
    navigate('/customers/new');
  }
}











































