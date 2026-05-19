import { Navigate, useSearchParams } from 'react-router';
import { supportedWorkbenchSearchParams } from '../../../features/product-lanes/product-lanes';

export default function WorkbenchRoute() {
  const [searchParams] = useSearchParams();
  const targetParams = new URLSearchParams();

  for (const key of supportedWorkbenchSearchParams) {
    if (key === 'kind') {
      continue;
    }
    const value = searchParams.get(key)?.trim();
    if (value) {
      targetParams.set(key, value);
    }
  }

  const encoded = targetParams.toString();
  return <Navigate replace to={`/workbench/requirements${encoded ? `?${encoded}` : ''}`} />;
}
