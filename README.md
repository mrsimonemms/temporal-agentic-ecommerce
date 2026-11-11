# temporal-agentic-ecommerce

A reference architecture for using Temporal to build agentic ecommerce applications

Built for Stripe's Agentic Dev Day talk, **"Agents can buy. Can your systems deliver?"**

<!-- toc -->

* [What it demonstrates](#what-it-demonstrates)
* [Run](#run)
* [Try the failure scenarios](#try-the-failure-scenarios)
* [Contributing](#contributing)

<!-- Regenerate with "pre-commit run -a markdown-toc" -->

<!-- tocstop -->

## What it demonstrates

AI gives software the ability to make decisions. Durable execution gives us the
confidence to let it act on them.

The demo combines OpenAI, Temporal and a merchant checkout API to run two
independent durable processes:

* **Shopping Agent Workflow:** interprets a natural-language request, discovers
  products, plans a purchase with OpenAI function calling, waits for human
  approval and completes checkout.
* **Order Workflow:** takes responsibility for the resulting Order, handling
  inventory reservation, retries, fulfilment exceptions and human intervention.

The agent finishes once it has purchased. The Order continues independently
until it is fulfilled.

The merchant checkout uses the [Universal Commerce Protocol](https://ucp.dev)
(UCP), so the agent buys through a standard commerce interface rather than
calling internal services.

```text
"Buy me a kettle and two sets of mugs. Keep it under £100."
        |
Shopping Agent Workflow --(UCP checkout)--> Commerce API
                                                |
                                         Order Workflow
```

## Run

You need [Docker](https://docs.docker.com/get-docker/) with Docker Compose and
an [OpenAI API key](https://platform.openai.com/api-keys).

The worker reads `OPENAI_API_KEY` from your shell environment and refuses to
start without it. Export it in the shell you run Compose from, rather than
writing it into a file in the repository:

```bash
export OPENAI_API_KEY=<your-openai-api-key>
```

Start the stack:

```bash
docker compose up
```

The first start builds the images and installs dependencies, so it may take a
few minutes. Once the services are healthy, open:

* Dashboard: <http://localhost:5173>
* Temporal Web UI: <http://localhost:8233>

Stop the stack with `Ctrl+C`, or from another terminal:

```bash
docker compose down
```

Add `--volumes` to also delete the MongoDB and Temporal data.

## Try the failure scenarios

All scenarios start from the dashboard. Watch the Workflows in the Temporal Web
UI alongside it.

**Normal purchase.** Start the shopping agent with the prefilled kettle-and-mugs
request. Approve the proposal, then select **Follow the Order** to watch the
Order Workflow reserve inventory and confirm the Order.

**Simulated AI failure.** Select **AI service unavailable** before starting the
agent. The planning Activity fails five times before Temporal retries it
successfully. The catalogue retrieval that already completed is not repeated.

**Inventory failures.** Choose 1 or 2 under **inventory failures** before
starting the agent. The first reservation attempts in the Order Workflow fail
and Temporal retries them until the reservation succeeds. The agent is not
affected.

**Fulfilment exception.** Once the Order is confirmed, select **Report
fulfilment exception**. The Order waits for intervention. Select **Approve
alternative source**, then **Mark fulfilled**.

**Worker restart.** While a Workflow is running or awaiting approval or
intervention, stop the worker:

```bash
docker compose stop orderworker
```

The Workflow's state is held by Temporal Server, not the worker, so nothing is
lost while the worker is unavailable. Restart it and the Workflow resumes where
it left off:

```bash
docker compose start orderworker
```

You can go further and stop every application service while Temporal Server
and MongoDB keep running:

```bash
docker compose stop webapp api orderworker
docker compose start orderworker api webapp
```

## Contributing

All commits must be done in the [Conventional Commit](https://www.conventionalcommits.org)
format.

```git
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```
