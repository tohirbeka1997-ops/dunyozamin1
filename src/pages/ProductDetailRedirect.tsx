import { useLocation, useParams, Navigate } from 'react-router-dom';

export default function ProductDetailRedirect() {
  const { id } = useParams();
  const location = useLocation();

  if (!id) {
    return <Navigate to="/products" replace />;
  }

  const params = new URLSearchParams(location.search);
  params.set('detail', id);
  const query = params.toString();
  const target = query ? `/products?${query}` : '/products';

  return <Navigate to={target} replace />;
}
