import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorStatus } from '@nestjs/terminus';
import {
  ApplicationFailure,
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
  WorkflowFailedError,
  WorkflowHandle,
  WorkflowNotFoundError,
  WorkflowUpdateFailedError,
} from '@temporalio/client';
import { grpc as grpcProto } from '@temporalio/proto';
import { setTimeout } from 'timers/promises';

import {
  ORDER_ERROR_INVALID_FULFILMENT_RESOLUTION,
  ORDER_QUERY_GET_ORDER,
  ORDER_SIGNAL_MARK_FULFILLED,
  ORDER_SIGNAL_REPORT_FULFILMENT_EXCEPTION,
  ORDER_TASK_QUEUE,
  ORDER_UPDATE_RESOLVE_FULFILMENT_EXCEPTION,
  ORDER_WORKFLOW_TYPE,
  Order,
  OrderInput,
  OrderUpdateRejectedError,
  ReportFulfilmentExceptionSignal,
  ResolveFulfilmentExceptionRequest,
} from './order-workflow';
import {
  ClosedShoppingAgent,
  DecidePurchaseRequest,
  PurchaseDecisionRejectedError,
  SHOPPING_AGENT_QUERY_GET,
  SHOPPING_AGENT_UPDATE_DECIDE_PURCHASE,
  SHOPPING_AGENT_WORKFLOW_TYPE,
  ShoppingAgent,
  ShoppingAgentInput,
} from './shopping-agent-workflow';
import { CONNECTION, WORKFLOW_CLIENT } from './temporal.providers';

// Upper bound on each Temporal request so an unavailable Temporal fails the
// request promptly rather than holding it open while the client retries
const REQUEST_TIMEOUT_MS = 5000;

@Injectable()
export class TemporalService implements OnApplicationShutdown {
  protected readonly logger = new Logger(this.constructor.name);

  @Inject(CONNECTION)
  private connection: Connection;

  @Inject(WORKFLOW_CLIENT)
  private client: Client;

  // Starts the Order Workflow using the Order ID as the Workflow ID. Starting
  // is idempotent: if a Workflow already exists for the Order, running or
  // closed, no new Workflow is created.
  async startOrderWorkflow(input: OrderInput): Promise<void> {
    try {
      await this.withDeadline(() =>
        this.client.workflow.start(ORDER_WORKFLOW_TYPE, {
          taskQueue: ORDER_TASK_QUEUE,
          workflowId: input.id,
          args: [input],
          workflowIdConflictPolicy: 'USE_EXISTING',
          workflowIdReusePolicy: 'REJECT_DUPLICATE',
        }),
      );
    } catch (err) {
      if (err instanceof WorkflowExecutionAlreadyStartedError) {
        this.logger.log(`Order Workflow "${input.id}" already exists`);
        return;
      }
      throw err;
    }
  }

  // Returns the current state of an Order, or undefined if no Order Workflow
  // exists with that ID. A running Order is queried. Fulfilment completes the
  // Order Workflow, so a completed Order is read from the Workflow result
  // rather than by querying a closed Workflow. Both are the same Order state.
  async getOrder(orderId: string): Promise<Order | undefined> {
    const handle = this.client.workflow.getHandle(orderId);
    const status = await this.workflowStatus(handle, ORDER_WORKFLOW_TYPE);

    switch (status) {
      case undefined:
        return undefined;
      case 'COMPLETED':
        return this.withDeadline(() => handle.result() as Promise<Order>);
      default:
        // Running, or ended without a result, for example when cancelled.
        // Such an Order is only available while a worker can answer the Query.
        return this.withDeadline(() => handle.query<Order>(ORDER_QUERY_GET_ORDER));
    }
  }

  // Signals the Order Workflow to mark the Order as fulfilled. Returns false if
  // no Order Workflow exists with that ID. A completed Order has already been
  // fulfilled, so the Signal has no further effect, as for a running Order
  // that ignores it.
  async markOrderFulfilled(orderId: string): Promise<boolean> {
    // The payload matches the Go MarkFulfilledSignal struct
    return this.signalOrder(orderId, ORDER_SIGNAL_MARK_FULFILLED, {});
  }

  // Signals the Order Workflow to report a fulfilment exception. Returns false
  // if no Order Workflow exists with that ID. Delivery does not mean the
  // Workflow accepted the exception: invalid exceptions are ignored, and a
  // completed Order accepts none.
  async reportFulfilmentException(
    orderId: string,
    signal: ReportFulfilmentExceptionSignal,
  ): Promise<boolean> {
    return this.signalOrder(orderId, ORDER_SIGNAL_REPORT_FULFILMENT_EXCEPTION, signal);
  }

  // Executes the Update resolving the current fulfilment exception and returns
  // the resulting Order, or undefined if no Order Workflow exists. Throws
  // OrderUpdateRejectedError when the Workflow rejects the resolution, or when
  // the Order has completed and so is not awaiting intervention.
  async resolveFulfilmentException(
    orderId: string,
    req: ResolveFulfilmentExceptionRequest,
  ): Promise<Order | undefined> {
    try {
      return await this.withDeadline(() =>
        this.client.workflow
          .getHandle(orderId)
          .executeUpdate<Order, [ResolveFulfilmentExceptionRequest]>(
            ORDER_UPDATE_RESOLVE_FULFILMENT_EXCEPTION,
            { args: [req] },
          ),
      );
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) {
        // A closed Workflow cannot accept Updates. Report it as the Workflow's
        // validator would, since a completed Order is not awaiting intervention.
        const order = await this.getOrder(orderId);
        if (!order) {
          return undefined;
        }
        throw new OrderUpdateRejectedError(
          `order is not awaiting intervention: status is ${order.status}`,
          ORDER_ERROR_INVALID_FULFILMENT_RESOLUTION,
        );
      }
      if (err instanceof WorkflowUpdateFailedError && err.cause instanceof ApplicationFailure) {
        throw new OrderUpdateRejectedError(err.cause.message, err.cause.type ?? undefined);
      }
      throw err;
    }
  }

  // Sends a Signal to an Order Workflow. Returns false only if no Order
  // Workflow exists. A closed Workflow cannot receive Signals, which has the
  // same effect as a running Workflow ignoring one it cannot accept.
  private async signalOrder(orderId: string, name: string, payload: unknown): Promise<boolean> {
    const handle = this.client.workflow.getHandle(orderId);
    try {
      await this.withDeadline(() => handle.signal(name, payload));
      return true;
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) {
        return (await this.workflowStatus(handle, ORDER_WORKFLOW_TYPE)) !== undefined;
      }
      throw err;
    }
  }

  // Starts a Shopping Agent Workflow. Each agent has a new ID, so an existing
  // Workflow with the same ID is never reused.
  async startShoppingAgentWorkflow(id: string, input: ShoppingAgentInput): Promise<void> {
    await this.withDeadline(() =>
      this.client.workflow.start(SHOPPING_AGENT_WORKFLOW_TYPE, {
        taskQueue: ORDER_TASK_QUEUE,
        workflowId: id,
        args: [input],
        workflowIdConflictPolicy: 'FAIL',
        workflowIdReusePolicy: 'REJECT_DUPLICATE',
      }),
    );
  }

  // Returns the Shopping Agent state, or undefined if no Shopping Agent
  // Workflow exists with that ID. A running Workflow is queried. A closed
  // Workflow is not queried: its final state is its result or, if it failed,
  // the state attached to its failure.
  async getShoppingAgent(id: string): Promise<ShoppingAgent | ClosedShoppingAgent | undefined> {
    const handle = this.client.workflow.getHandle(id);
    const status = await this.workflowStatus(handle, SHOPPING_AGENT_WORKFLOW_TYPE);

    switch (status) {
      case undefined:
        return undefined;
      case 'RUNNING':
        return this.withDeadline(() => handle.query<ShoppingAgent>(SHOPPING_AGENT_QUERY_GET));
      case 'COMPLETED':
        return this.withDeadline(() => handle.result() as Promise<ShoppingAgent>);
      default:
        return this.closedShoppingAgent(id, handle);
    }
  }

  // Executes the Update approving or rejecting the proposed purchase and
  // returns the resulting state, or undefined if no Shopping Agent Workflow
  // exists. Throws PurchaseDecisionRejectedError when the Workflow rejects
  // the decision or has already finished.
  async decidePurchase(id: string, req: DecidePurchaseRequest): Promise<ShoppingAgent | undefined> {
    const handle = this.client.workflow.getHandle(id);
    const status = await this.workflowStatus(handle, SHOPPING_AGENT_WORKFLOW_TYPE);
    if (status === undefined) {
      return undefined;
    }

    const finished = () =>
      new PurchaseDecisionRejectedError('shopping agent has finished and cannot accept a decision');
    if (status !== 'RUNNING') {
      throw finished();
    }

    try {
      return await this.withDeadline(() =>
        handle.executeUpdate<ShoppingAgent, [DecidePurchaseRequest]>(
          SHOPPING_AGENT_UPDATE_DECIDE_PURCHASE,
          { args: [req] },
        ),
      );
    } catch (err) {
      if (err instanceof WorkflowUpdateFailedError && err.cause instanceof ApplicationFailure) {
        throw new PurchaseDecisionRejectedError(err.cause.message, err.cause.type ?? undefined);
      }
      // The Workflow closed after it was described
      if (err instanceof WorkflowNotFoundError) {
        throw finished();
      }
      throw err;
    }
  }

  // Returns the Temporal status of a Workflow of the given type, or undefined
  // if no Workflow exists with that ID or it is of another type
  private async workflowStatus(
    handle: WorkflowHandle,
    workflowType: string,
  ): Promise<string | undefined> {
    try {
      const description = await this.withDeadline(() => handle.describe());
      return description.type === workflowType ? description.status.name : undefined;
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) {
        return undefined;
      }
      throw err;
    }
  }

  private async closedShoppingAgent(
    id: string,
    handle: WorkflowHandle,
  ): Promise<ShoppingAgent | ClosedShoppingAgent> {
    try {
      return (await this.withDeadline(() => handle.result())) as ShoppingAgent;
    } catch (err) {
      if (!(err instanceof WorkflowFailedError)) {
        throw err;
      }

      // The Workflow attaches its final state to planning and purchase failures
      const [state] = err.cause instanceof ApplicationFailure ? (err.cause.details ?? []) : [];
      if (isShoppingAgent(state)) {
        return state;
      }

      // Ended without recording its state, for example when terminated
      return { id, status: 'failed', error: err.cause?.message || err.message };
    }
  }

  private withDeadline<T>(fn: () => Promise<T>): Promise<T> {
    return this.client.withDeadline(Date.now() + REQUEST_TIMEOUT_MS, fn);
  }

  // Close connection once there are no further connections possible
  async onApplicationShutdown() {
    this.logger.log('Disconnecting from Temporal server');
    await this.connection.close();
  }

  async healthcheck(
    timeout: number = 1000,
    serviceName = 'temporal',
  ): Promise<HealthIndicatorResult> {
    this.logger.debug('Performing Temporal healthcheck');

    let status: HealthIndicatorStatus = 'down';

    try {
      const healthcheck = await Promise.race<grpcProto.health.v1.HealthCheckResponse>([
        this.connection.healthService.check({}),
        setTimeout(timeout).then(() => {
          throw new Error(`Temporal not connected within ${timeout}ms`);
        }),
      ]);

      if (healthcheck.status === grpcProto.health.v1.HealthCheckResponse.ServingStatus.SERVING) {
        status = 'up';
      }
    } catch (err) {
      this.logger.error('Temporal unhealthy', err);
    }

    return {
      [serviceName]: {
        status,
      },
    };
  }
}

function isShoppingAgent(value: unknown): value is ShoppingAgent {
  return (
    !!value && typeof value === 'object' && 'id' in value && 'status' in value && 'request' in value
  );
}
