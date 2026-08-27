# ADR-0007: Borrow pre-existing Pi packages

Status: Accepted, 2026-08-27.

## Decision

The installation graph distinguishes `external` bindings from `managed`
bindings. A package already selected by the user is external only after its
settings spec, lockfile version/resolution/integrity, physical package identity,
tree digest and lifecycle audit match the governed inventory. External packages
are neither staged into the immutable generation nor recorded in
`onlyMyPi.managedSettings`.

only-my-pi owns only its generated package/resource bundle and mutable Harness
state. Uninstall, rollback and generation GC preserve every external package.
Missing or drifting evidence fails closed; installation never silently adopts,
duplicates or replaces a user package. Adoption is not part of M8.

## Consequences

Package bindings are included in the graph digest and status receipt. External
bindings include no credentials and expose only canonical source identity,
version, integrity, physical tree digest and owner. Real-root acceptance must
prove that apply/rollback/reapply leaves all nine pre-existing package entries
under user ownership.
