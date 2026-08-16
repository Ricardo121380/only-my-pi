# M1 contract catalog

`schema-catalog.json` is the single registry for versioned repository contracts.
Every entry binds a public kind to one local Draft 2020-12 schema, at least one
production document, and positive/negative fixtures. Paths are repository
relative; remote, absolute, backslash, and parent-traversing references are not
allowed.

The Mode, Agent, Workflow, and Swarm Recipe documents introduced in M1 carry
`"contractStatus": "contract-only"`. They are non-vacuous production contract
instances, not claims that the M3–M5 registries or runtime adapters exist.

`contracts/bootstrap/*.example.json` are low-sensitive conformance examples
for the durable M2 file formats. They are never loaded as live state and do not
claim that a transaction, generation, Provider, or model was executed.
