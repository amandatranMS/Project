import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Governance tests for the human-in-the-loop approval gate.
 *
 * The single most important invariant in this codebase: an agent may PROPOSE a
 * change or a message, but nothing is written or sent until a human approves it.
 * These tests pin that behaviour so it cannot regress silently.
 *
 * Everything below the service (Prisma, Graph, the entity services) is mocked,
 * so the suite runs with no database and no Azure connectivity.
 */

const prismaMock = {
  approvalRequest: {
    findUnique: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  aiMilestoneRecommendation: { update: vi.fn() },
  opportunityMilestone: { findFirst: vi.fn() },
};

const recordAgentAction = vi.fn();
const milestonesService = { create: vi.fn(), update: vi.fn(), remove: vi.fn() };
const opportunitiesService = { create: vi.fn(), update: vi.fn(), createForApproval: vi.fn() };
const dealTeamMembersService = { update: vi.fn() };
const graphService = { sendMail: vi.fn(), notifyTeams: vi.fn(), notifyTenantTeams: vi.fn() };

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/lib/audit.js', () => ({ recordAgentAction }));
vi.mock('../src/services/milestones.service.js', () => ({ milestonesService }));
vi.mock('../src/services/opportunities.service.js', () => ({ opportunitiesService }));
vi.mock('../src/services/dealTeamMembers.service.js', () => ({ dealTeamMembersService }));
vi.mock('../src/services/graph.service.js', () => ({ graphService }));

const { approvalRequestsService } = await import('../src/services/approvalRequests.service.js');

const ACTION_TAG = 'MSX_ACTION::';

/** Build a pending approval row as it would come back from Prisma. */
function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'apr-1',
    approvalRequestBusinessId: 'APR-001',
    approvalStatus: 'Pending',
    requestStatus: 'Submitted',
    opportunityId: 'opp-1',
    relatedRecommendationId: null,
    relatedRecommendation: null,
    errorMessage: null,
    ...overrides,
  };
}

/** Every service that can perform a real write or send. */
function allSideEffects() {
  return [
    milestonesService.create,
    milestonesService.update,
    milestonesService.remove,
    opportunitiesService.create,
    opportunitiesService.update,
    opportunitiesService.createForApproval,
    dealTeamMembersService.update,
    graphService.sendMail,
    graphService.notifyTeams,
    graphService.notifyTenantTeams,
  ];
}

function expectNothingExecuted() {
  for (const fn of allSideEffects()) expect(fn).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.approvalRequest.update.mockImplementation(async ({ data }: any) => ({ id: 'apr-1', ...data }));
  prismaMock.approvalRequest.create.mockImplementation(async ({ data }: any) => ({
    id: 'apr-1',
    opportunityId: 'opp-1',
    relatedMilestoneId: null,
    relatedRecommendationId: null,
    ...data,
  }));
});

describe('approval gate — a rejected decision executes nothing', () => {
  it('does not perform the deferred update when rejected', async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValue(
      pendingRow({
        errorMessage:
          ACTION_TAG + JSON.stringify({ kind: 'UpdateMilestone', milestoneId: 'ms-1', milestoneStatus: 'Completed' }),
      }),
    );

    await approvalRequestsService.decide('apr-1', 'Rejected', { reviewedBy: 'human@example.com' } as never);

    expectNothingExecuted();
  });

  it('does not send the drafted email when rejected', async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValue(
      pendingRow({
        errorMessage:
          ACTION_TAG +
          JSON.stringify({ kind: 'SendOutlookMail', to: 'someone@example.com', subject: 'Hi', body: 'Body' }),
      }),
    );

    await approvalRequestsService.decide('apr-1', 'Rejected', { reviewedBy: 'human@example.com' } as never);

    expect(graphService.sendMail).not.toHaveBeenCalled();
    expectNothingExecuted();
  });

  it('discards the stored action so a rejected request cannot be replayed', async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValue(
      pendingRow({ errorMessage: ACTION_TAG + JSON.stringify({ kind: 'DeleteMilestone', milestoneId: 'ms-1' }) }),
    );

    await approvalRequestsService.decide('apr-1', 'Rejected', {
      reviewedBy: 'human@example.com',
      notes: 'Not appropriate',
    } as never);

    const written = prismaMock.approvalRequest.update.mock.calls[0][0].data;
    expect(written.errorMessage).toBe('Not appropriate');
    expect(written.errorMessage).not.toContain(ACTION_TAG);
  });
});

describe('approval gate — needs-changes executes nothing but preserves the action', () => {
  it('does not execute, and keeps the encoded action for a later approval', async () => {
    const encoded =
      ACTION_TAG + JSON.stringify({ kind: 'UpdateMilestone', milestoneId: 'ms-1', milestoneStatus: 'Completed' });
    prismaMock.approvalRequest.findUnique.mockResolvedValue(pendingRow({ errorMessage: encoded }));

    await approvalRequestsService.decide('apr-1', 'Needs Changes', { reviewedBy: 'human@example.com' } as never);

    expectNothingExecuted();
    expect(prismaMock.approvalRequest.update.mock.calls[0][0].data.errorMessage).toBe(encoded);
  });
});

describe('approval gate — approval is the only path that executes', () => {
  it('executes an UpdateMilestone exactly once and audits it', async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValue(
      pendingRow({
        errorMessage:
          ACTION_TAG + JSON.stringify({ kind: 'UpdateMilestone', milestoneId: 'ms-1', milestoneStatus: 'Completed' }),
      }),
    );
    milestonesService.update.mockResolvedValue({ id: 'ms-1' });

    await approvalRequestsService.decide('apr-1', 'Approved', { reviewedBy: 'human@example.com' } as never);

    expect(milestonesService.update).toHaveBeenCalledTimes(1);
    expect(milestonesService.update.mock.calls[0][0]).toBe('ms-1');
    expect(recordAgentAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'UpdateMilestone', actionName: 'Executed after approval' }),
    );
  });

  it('executes a DeleteMilestone only after approval', async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValue(
      pendingRow({ errorMessage: ACTION_TAG + JSON.stringify({ kind: 'DeleteMilestone', milestoneId: 'ms-9' }) }),
    );
    milestonesService.remove.mockResolvedValue({ id: 'ms-9' });

    await approvalRequestsService.decide('apr-1', 'Approved', { reviewedBy: 'human@example.com' } as never);

    expect(milestonesService.remove).toHaveBeenCalledTimes(1);
    expect(milestonesService.remove).toHaveBeenCalledWith('ms-9');
  });

  it('sends a drafted email only after approval, and flags it as a security event', async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValue(
      pendingRow({
        errorMessage:
          ACTION_TAG +
          JSON.stringify({ kind: 'SendOutlookMail', to: 'seller@example.com', subject: 'Update', body: 'Body' }),
      }),
    );
    graphService.sendMail.mockResolvedValue({ status: 'sent' });

    await approvalRequestsService.decide('apr-1', 'Approved', { reviewedBy: 'human@example.com' } as never);

    expect(graphService.sendMail).toHaveBeenCalledTimes(1);
    expect(graphService.sendMail.mock.calls[0][1]).toMatchObject({
      to: 'seller@example.com',
      subject: 'Update',
      body: 'Body',
      confirm: true,
    });
    expect(recordAgentAction).toHaveBeenCalledWith(expect.objectContaining({ securityEvent: true }));
  });
});

describe('approval gate — replay and tamper protection', () => {
  it('refuses to approve an already-approved request', async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValue(
      pendingRow({
        approvalStatus: 'Approved',
        errorMessage: ACTION_TAG + JSON.stringify({ kind: 'DeleteMilestone', milestoneId: 'ms-1' }),
      }),
    );

    await expect(
      approvalRequestsService.decide('apr-1', 'Approved', { reviewedBy: 'human@example.com' } as never),
    ).rejects.toMatchObject({ status: 409 });

    expectNothingExecuted();
  });

  it('refuses to execute a tampered/undecodable action instead of guessing', async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValue(pendingRow({ errorMessage: ACTION_TAG + '{not valid json' }));

    await expect(
      approvalRequestsService.decide('apr-1', 'Approved', { reviewedBy: 'human@example.com' } as never),
    ).rejects.toMatchObject({ status: 422 });

    expectNothingExecuted();
  });

  it('refuses an action whose kind is not in the allow-list', async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValue(
      pendingRow({ errorMessage: ACTION_TAG + JSON.stringify({ kind: 'DropAllTables' }) }),
    );

    await expect(
      approvalRequestsService.decide('apr-1', 'Approved', { reviewedBy: 'human@example.com' } as never),
    ).rejects.toMatchObject({ status: 422 });

    expectNothingExecuted();
  });
});

describe('approval gate — submitting a proposal never executes it', () => {
  it('stores the action tagged on errorMessage and marks the request Submitted', async () => {
    await approvalRequestsService.create({
      requestName: 'Update milestone ms-1',
      requestedBy: 'InAppAgent',
      action: { kind: 'UpdateMilestone', milestoneId: 'ms-1', milestoneStatus: 'Completed' },
    } as never);

    const written = prismaMock.approvalRequest.create.mock.calls[0][0].data;
    expect(written.errorMessage.startsWith(ACTION_TAG)).toBe(true);
    expect(JSON.parse(written.errorMessage.slice(ACTION_TAG.length))).toMatchObject({
      kind: 'UpdateMilestone',
      milestoneId: 'ms-1',
    });
    expect(written.requestStatus).toBe('Submitted');
    expect(written.approvalStatus).toBe('Pending');

    // Submitting a proposal must not perform the change.
    expectNothingExecuted();
  });
});
