# Schemas

These strict JSON Schema Draft 2020-12 documents define the versioned M1
contracts for package and first-party resource inventories, Profiles,
capabilities, owners, command ownership, enforcement surfaces, Modes, Agent
roles, Workflows, Swarm Recipes, and the semantic Theme layer. The catalog
also contains the transactional bootstrap wire schemas used by M2.

`contracts/schema-catalog.json` is the only schema registry. Every catalog
entry names one schema, one or more non-fixture production documents, and a
fixture directory. Schema `$ref` values are local fragments only; repository
documents use relative `$schema` links so editors and validation work offline.

`npm run schema:check` uses Ajv 2020 in strict mode, rejects vacuous kinds, and
runs cross-document semantic validation for duplicate IDs, unknown references,
cycles, capability escalation, ownership collisions, and read-only writer/tool
violations. Positive and negative documents live under
`verification/fixtures/contracts/`.

The M1 Mode, Agent, Workflow, and Recipe seeds explicitly declare
`contractStatus: "contract-only"`. Schema validity proves their contract shape;
it does not claim the M3–M5 runtime is implemented or live Provider execution
has been tested.

Theme contracts intentionally live under `contracts/themes/`, while Pi-native
theme JSON remains under `themes/`; this prevents Pi's resource loader from
mistaking governance metadata for a theme. Theme validation additionally
recomputes contrast receipts and checks that semantic tokens match the public
Pi theme variables.
