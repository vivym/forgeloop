import { Navigate, useSearchParams } from 'react-router';
import { defaultProductLaneId } from '../../../features/product-lanes/product-lanes';
import { isProductLaneSearchParamSupported, supportedProductLaneSearchParams } from '../../../shared/api/types';

export default function ProductLanesRoute() {
  const [searchParams] = useSearchParams();
  const targetParams = new URLSearchParams();

  for (const key of supportedProductLaneSearchParams) {
    if (!isProductLaneSearchParamSupported(defaultProductLaneId, key)) {
      continue;
    }
    const value = searchParams.get(key)?.trim();
    if (value) {
      targetParams.set(key, value);
    }
  }

  const encoded = targetParams.toString();
  return <Navigate replace to={`/lanes/${defaultProductLaneId}${encoded ? `?${encoded}` : ''}`} />;
}
