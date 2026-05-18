import { Button } from '../../shared/ui';
import { productRoles, type ProductRole } from './role-labels';

export function RoleSwitcher({ activeRole }: { activeRole: ProductRole }) {
  return (
    <div className="role-tabs" aria-label="Workbench role">
      {productRoles.map((role) => (
        <Button
          aria-label={`${role} role filter`}
          aria-pressed={role === activeRole}
          className={role === activeRole ? 'active' : undefined}
          disabled
          key={role}
          title="Role switching pending wiring"
          variant="ghost"
        >
          {role === activeRole ? 'Work Item Owner' : role}
        </Button>
      ))}
    </div>
  );
}
