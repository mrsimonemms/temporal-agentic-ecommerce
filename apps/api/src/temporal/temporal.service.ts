import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorStatus } from '@nestjs/terminus';
import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from '@temporalio/client';
import { grpc as grpcProto } from '@temporalio/proto';
import { setTimeout } from 'timers/promises';

import {
  ORDER_QUERY_GET_ORDER,
  ORDER_SIGNAL_MARK_FULFILLED,
  ORDER_TASK_QUEUE,
  ORDER_WORKFLOW_TYPE,
  Order,
  OrderInput,
} from './order-workflow';
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
  // exists with that ID
  async getOrder(orderId: string): Promise<Order | undefined> {
    try {
      return await this.withDeadline(() =>
        this.client.workflow.getHandle(orderId).query<Order>(ORDER_QUERY_GET_ORDER),
      );
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) {
        return undefined;
      }
      throw err;
    }
  }

  // Signals the Order Workflow to mark the Order as fulfilled. Returns false if
  // no running Order Workflow exists with that ID.
  async markOrderFulfilled(orderId: string): Promise<boolean> {
    try {
      // The payload matches the Go MarkFulfilledSignal struct
      await this.withDeadline(() =>
        this.client.workflow.getHandle(orderId).signal(ORDER_SIGNAL_MARK_FULFILLED, {}),
      );
      return true;
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) {
        return false;
      }
      throw err;
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
