---
path_policy:
  allowed_paths:
    - ".github/**"
    - "apps/**"
    - "docs/**"
    - "packages/**"
    - "scripts/**"
    - "tests/**"
    - "README.md"
    - "package.json"
    - "pnpm-lock.yaml"
  forbidden_paths:
    - ".git"
    - ".git/**"
    - "node_modules/**"
    - ".env"
observability:
  public_summary: "ForgeLoop default runtime policy for package execution."
---

ForgeLoop runtime policy baseline for package execution.
