import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import {
  ClosedShoppingAgent,
  DecidePurchaseRequest,
  PurchaseDecisionRejectedError,
  ShoppingAgent,
} from '../temporal/shopping-agent-workflow';
import { TemporalService } from '../temporal/temporal.service';
import { StartShoppingAgentDto } from './shopping-agent.dto';

const AGENT_ID_PREFIX = 'agent_';

// Demo-only operations on the Shopping Agent Workflow. The Workflow is the
// only record of the agent: its state is not persisted by the API.
@Injectable()
export class ShoppingAgentService {
  constructor(private readonly temporal: TemporalService) {}

  async start(dto: StartShoppingAgentDto): Promise<{ id: string }> {
    const id = `${AGENT_ID_PREFIX}${randomUUID()}`;

    await this.temporal.startShoppingAgentWorkflow(id, {
      request: dto.request,
      buyer: { email: dto.buyer.email, name: dto.buyer.name },
      demo: dto.demo && { inventoryFailures: dto.demo.inventoryFailures },
    });

    return { id };
  }

  async get(id: string): Promise<ShoppingAgent | ClosedShoppingAgent> {
    // Only IDs issued by this API are looked up
    const agent = id.startsWith(AGENT_ID_PREFIX)
      ? await this.temporal.getShoppingAgent(id)
      : undefined;
    if (!agent) {
      throw this.notFound(id);
    }
    return agent;
  }

  async decide(id: string, req: DecidePurchaseRequest): Promise<ShoppingAgent> {
    if (!id.startsWith(AGENT_ID_PREFIX)) {
      throw this.notFound(id);
    }

    let agent: ShoppingAgent | undefined;
    try {
      agent = await this.temporal.decidePurchase(id, {
        decision: req.decision,
        decidedBy: req.decidedBy,
        note: req.note,
      });
    } catch (err) {
      if (err instanceof PurchaseDecisionRejectedError) {
        throw new ConflictException(err.message);
      }
      throw err;
    }

    if (!agent) {
      throw this.notFound(id);
    }
    return agent;
  }

  private notFound(id: string): NotFoundException {
    return new NotFoundException(`Shopping agent "${id}" was not found`);
  }
}
