# Agent Instructions

## Project overview

This repository is a reference architecture demonstrating how Temporal and the
Universal Commerce Protocol (UCP) can work together to support durable,
long-running commerce processes.

The central principle is:

**UCP defines the interoperable commerce interface. Temporal coordinates the
durable execution of the business processes behind it.**

The project is intended to demonstrate patterns relevant to enterprise retailers
and marketplaces, not to become a production-ready commerce platform.

Examples should be understandable, realistic and sufficiently generic to apply
to different retail scenarios.

## Technology stack

The existing repository structure and technology choices are intentional.

- **API:** TypeScript, NestJS and the official `@ucp-js/sdk` package
- **Worker:** Go and the Temporal Go SDK
- **Web application:** SvelteKit
- **Database:** MongoDB, using Mongoose in the API
- **Orchestration:** Temporal
- **Monorepo:** Moon
- **Local development:** Docker Compose and VS Code Dev Containers

Key directories:

- `apps/api`: UCP endpoints, application API, persistence and Temporal client integration
- `apps/web`: Web application
- `workers/order`: Temporal order worker
- `packages`: Shared packages where genuinely useful
- `.moon`: Monorepo tooling and task definitions

Inspect the existing implementation before making changes. Preserve established
conventions, configuration and project structure.

Do not introduce replacement frameworks, additional infrastructure or new
architectural layers without a demonstrated need.

## Architectural principles

### UCP is an interface, not the domain model

The project targets the official UCP specification version `2026-08-25`.

Use the official `@ucp-js/sdk` package for available TypeScript types, schemas
and validation.

Prefer official versioned UCP specifications and schemas over assumptions
derived from older sample implementations.

The UCP API is a northbound interface to the commerce system. Internal business
processes must remain independent of UCP so that other channels could eventually
use the same functionality.

Conceptually:

```text
Web | Mobile | POS | AI Agent | Marketplace
                    |
             UCP / REST / Events
                    |
              Commerce API
                    |
             Temporal Workflows
                    |
       External domain systems
```

Do not expose Temporal implementation details through UCP contracts unless
explicitly appropriate.

Do not invent UCP protocol fields or endpoints. Clearly distinguish standard UCP
functionality from demo-specific APIs and extensions.

Only advertise capabilities that are actually implemented, unless explicitly
working with an incomplete development profile.

### Orders are long-lived commercial entities

An Order represents the commercial commitment between a buyer and a merchant.

An Order is not equivalent to a payment, shipment or fulfilment operation.

The intended conceptual domain includes:

```text
Order
├── Order Lines
├── Commercial Terms
├── Payment Obligations
├── Fulfilment Plan
│   ├── Fulfilment Groups
│   ├── Shipments / Consignments
│   └── Service Fulfilment
├── Adjustments
└── Returns
```

This is a conceptual model, not an instruction to implement every component
immediately.

The same Order abstraction should eventually support:

- Simple retail orders fulfilled within hours
- Orders split across multiple fulfilment locations
- Click-and-collect
- Marketplace and supplier fulfilment
- Bulky and scheduled deliveries
- Made-to-order products
- Long-running orders involving installation or services
- Partial fulfilment, cancellation, returns and amendments

Avoid introducing order-type-specific Workflow implementations unless there is a
compelling reason.

### Temporal owns durable coordination

Use the Entity Workflow pattern for the top-level Order.

An Order Workflow should maintain the state necessary to coordinate the
commercial lifecycle and respond to external events.

Prefer:

- Activities for interactions with external systems
- Signals for asynchronous external events
- Updates when synchronous validation or acknowledgement is required
- Queries for operational Workflow state
- Child or independent Workflows where separate lifecycles justify them
- Continue-As-New where necessary for long-running execution histories

Do not introduce child Workflows merely to represent every domain object.

Do not use Temporal as a general-purpose database.

MongoDB may hold commerce records, checkout data and read models. Define clear
ownership of state and avoid creating competing authoritative representations
without an explicit synchronisation strategy.

Follow Temporal determinism requirements. Workflow code must not perform
arbitrary external I/O.

### Fulfilment is a plan, not a fixed sequence

The Order describes what was purchased.

The Fulfilment Plan describes how the merchant currently intends to satisfy the
Order.

The plan may change without changing the original commercial commitment.

The important orchestration pattern is:

```text
Plan
  |
Execute
  |
Observe reality
  |
Replan if necessary
```

For example, if an item becomes unavailable at its originally selected
warehouse, the system should be capable of revising the fulfilment plan without
replacing the entire Order.

Inventory, sourcing, pricing, tax, fraud, payments and logistics remain
responsibilities of specialist domain systems.

Temporal coordinates those systems rather than replacing their business logic.

### Payments are independent obligations

Avoid modelling payment as a single global `paymentStatus` when that would
restrict the architecture.

Orders may eventually support deposits, staged payments, invoices, refunds and
credit terms.

Fulfilment completion does not necessarily imply that all payment obligations
have been settled.

This is a future architectural requirement, not an instruction to build
comprehensive payment functionality immediately.

## Implementation priorities

The immediate objective is to establish a working vertical slice through the
existing architecture.

The intended progression is:

1. Accept and validate a UCP checkout request.
2. Complete checkout and create an internal Order.
3. Start a long-running Temporal Order Workflow.
4. Expose Order state through the API using appropriate UCP representations.
5. Execute simulated inventory and fulfilment operations.
6. Receive asynchronous events that change the Order's progress.
7. Demonstrate a failure or delay requiring fulfilment replanning.

Implement the smallest useful version of each capability.

Prefer stubbed domain dependencies where real integrations would distract from
demonstrating durable orchestration.

A simple order should work before introducing split fulfilment or complex
amendments.

## Demo and reference architecture principles

This project is intended to demonstrate Temporal's value in agentic commerce and
enterprise order management.

The important behaviour is what happens after a purchase is initiated.

A compelling demonstration should show that:

- A purchase can originate through a standard commerce protocol.
- The resulting business process continues independently of the originating
  client or agent.
- External operations may fail, be delayed or require intervention.
- Temporal preserves the process state and coordinates recovery.
- Order state and fulfilment expectations remain visible through the commerce interface.

Prioritise demonstrable business behaviour over technical sophistication.

The web application should help illustrate the scenario, not become the primary
engineering focus.

Use realistic but simple examples and simulated external dependencies.

## Engineering conventions

### Respect the existing codebase

Before implementing a change:

- Read and follow this document.
- Inspect relevant existing files, tests and conventions.
- Understand the existing module boundaries and dependencies.
- Reuse established configuration, dependencies and tooling.
- Identify the smallest coherent change that satisfies the request.

Preserve existing behaviour unless a change is explicitly required.

Do not rewrite unrelated code, reorganise directories, rename components or
introduce abstractions solely for stylistic reasons.

Do not change dependencies or upgrade versions unless required for the task.

Correctness takes precedence over convenience. Prefer explicit validation and
errors over silently accepting invalid behaviour.

### Avoid premature abstraction

Do not create a reusable NestJS UCP module, generic commerce framework,
elaborate Workflow framework or additional shared package without explicit
instruction.

Potential extraction points may be identified, but should remain within the
existing implementation until reuse is justified.

Prefer straightforward code over speculative extensibility.

Do not implement future requirements merely because they are described in this
document.

### Keep the protocol boundary explicit

Separate:

- UCP request and response validation
- Mapping between UCP and internal commerce representations
- Business operations
- Temporal Workflow orchestration
- External system integration

This separation should be logical and maintainable, not an excuse to create
excessive layers or interfaces.

### API documentation is mandatory

Every endpoint exposed by `apps/api` must have accurate Swagger/OpenAPI
documentation.

- Create or update the documentation for new or modified endpoints as part of
  the same change.
- Describe the actual implemented behaviour, including request validation,
  request bodies, responses, HTTP status codes and errors.
- Reuse existing schemas, such as the official `@ucp-js/sdk` schemas, rather
  than duplicating them in hand-maintained DTOs where practical.
- Do not advertise unimplemented functionality as operational. Placeholders
  must be documented as placeholders.

Swagger/OpenAPI documentation belongs exclusively to `apps/api`. Do not
introduce Swagger or OpenAPI tooling elsewhere in the repository.

### Svelte development and MCP

When working on `apps/web`, use the configured Svelte MCP server as the
authoritative source for current Svelte 5 and SvelteKit framework guidance.

Before implementing or substantially modifying Svelte components:

- Inspect the existing application and its conventions.
- Consult the Svelte MCP documentation tools for the relevant Svelte 5 and
  SvelteKit APIs.
- Follow current Svelte 5 patterns, including runes where appropriate.
- Use the Svelte MCP validation/autofix tools on new or modified Svelte
  components where available.
- Address all actionable diagnostics before considering the task complete.

Do not blindly apply automated fixes. Review proposed changes and preserve
intended behaviour.

Do not introduce deprecated Svelte patterns, unnecessary dependencies or
additional frameworks.

The Svelte MCP server provides framework guidance and validation. It does not
override this document, the existing application architecture or the project's
quality gates.

If the MCP server is unavailable, report that limitation and continue using
established project conventions. Do not claim MCP validation was performed when
it was not.

### Quality gates are mandatory

All applicable formatting, linting, build and test checks must pass before work
is considered complete.

Use the existing Moon tasks and project-specific tooling.

Run the relevant checks for modified projects, followed by:

```bash
pre-commit run --all-files
```

When Go code changes, also run the applicable Go tests, vet and lint checks
using the repository's existing tooling.

When TypeScript or Svelte code changes, run the applicable lint, type-check,
build and test tasks.

If any check fails:

1. Investigate the actual cause.
2. Fix the underlying issue.
3. Rerun the failed check.
4. Repeat until all required checks pass.

**Never suppress, ignore or work around a failing check to obtain a passing
result.**

Specifically, do not:

- Disable lint rules or formatters.
- Add `nolint`, `eslint-disable`, `@ts-ignore` or equivalent suppression
  directives to bypass errors.
- Add exclusions or ignore patterns to hide failures.
- Disable, skip or delete failing tests.
- Modify lint, formatter, test or pre-commit configuration to weaken checks.
- Remove functionality or validation merely to make checks pass.
- Claim success when required checks have not passed.

If a genuine configuration defect requires changing a quality gate, explain the
problem and request approval before making that change.

Do not consider work complete while required checks are failing. If a failure
cannot be resolved, report the blocker accurately rather than bypassing it.

### Testing

Add focused tests for new behaviour and meaningful edge cases.

Prefer behavioural tests over tests that merely assert implementation details.

Do not modify production behaviour solely to make tests easier to write.

When working with UCP, validate payloads against official schemas where
practical.

When working with Temporal, use the Temporal SDK testing facilities where
appropriate.

Never claim tests passed without running them.

### Git restrictions

**Never modify Git state unless explicitly instructed.**

Do not:

- Run `git add` or otherwise stage files.
- Commit changes.
- Push changes.
- Create or switch branches.
- Merge or rebase.
- Create, delete or modify tags.
- Alter the existing staging area.

Leave all modifications unstaged.

Read-only Git commands are permitted for inspection.

At the end of a task, run:

```bash
git status --short
```

Report the resulting changes without staging them.

### Scope and communication

Do not silently broaden the requested scope.

If an architectural decision is genuinely ambiguous and materially affects the
implementation, ask before proceeding.

Otherwise, make reasonable choices consistent with this document.

When completing a task, report:

- What changed and why.
- Any important architectural decisions.
- Which validation commands were executed.
- Whether each command passed or failed.
- Any remaining issues or blockers.
- The final Git working-tree status.

Do not claim functionality is implemented if it is only scaffolded.

Do not claim work is complete if mandatory validation is still failing.

## Writing and documentation

Use British English.

Avoid Oxford commas and em dashes.

Keep documentation factual, concise and technically precise.

Distinguish implemented functionality from planned functionality.

Prefer explaining why an architectural decision exists rather than merely
describing the code.

## Guiding principle

**Build the simplest implementation that demonstrates how Temporal makes the
real-world consequences of UCP commerce durable, observable and recoverable.**

Do not sacrifice that objective in pursuit of unnecessary completeness,
abstraction or infrastructure sophistication.
