---
title: "Admin Control Plane"
description: "Administrative management endpoints, state inspection, and runtime cache eviction."
---

The admin module hosts operational management endpoints mounted on dedicated administrative paths. It provides endpoints for inspecting breaker states, querying active routes, reporting memory usage, and executing cache purges. The administrative plane is isolated from public traffic and protected by dedicated authentication rules.

## Exports

| Symbol | Kind | Signature | Purpose |
| --- | --- | --- | --- |
| `AdminDeps` | interface | `interface AdminDeps` | Interface export for AdminDeps. |
| `AdminConfig` | interface | `interface AdminConfig` | Interface export for AdminConfig. |
| `AdminControlPlane` | class | `class AdminControlPlane` | Class export for AdminControlPlane. |

## Notes

### AdminControlPlane
Mounts internal endpoints (`/__admin/state`, `POST /__admin/cache/purge`) with authentication protection.

## Source

- `src/admin/control-plane.ts`

## See also

- [Deep Dive: Operations](/docs/deep-dive/operations/)
