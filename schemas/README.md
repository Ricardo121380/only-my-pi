# Schemas

These JSON Schema Draft 2020-12 documents describe the stable, versioned shape
of the package inventory and profiles. Repository documents use relative
`$schema` references so editors can resolve them offline.

The project deliberately has no runtime dependency on a general JSON Schema
engine. `npm run schema:check` verifies that every reference stays within this
directory, resolves to valid JSON, declares Draft 2020-12, and has a stable
`$id`. `package-doctor` and `profile-resolver` enforce the security-sensitive
semantic rules such as exact pins, candidate promotion, blocked packages, and
profile resolution.
