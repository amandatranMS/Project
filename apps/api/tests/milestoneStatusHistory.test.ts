import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression tests for milestone status history.
 *
 * A milestone's status can move through two different paths:
 *   1. POST /api/status-history  → statusHistoryService.create ("Change status" buttons)
 *   2. PATCH /api/milestones/:id → milestonesService.update      (Edit form, and an
 *      approved agent UpdateMilestone action)
 *
 * Both mutate the same governed field, so BOTH must append to the append-only
 * transition history. Path 2 previously updated the status silently, which left
 * the milestone timeline incomplete and made agent-driven status changes
 * invisible on the detail screen. These tests pin the corrected behaviour.
 *
 * Everything below the service is mocked, so the suite runs with no database.
 */

const prismaMock = {
  opportunityMilestone: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  milestoneStatusHistory: {
    create: vi.fn(),
  },
  // Returns the operation results in order, mirroring Prisma's array form.
  $transaction: vi.fn(async (ops: unknown[]) => ops),
};

const recordAgentAction = vi.fn();
const maybeNotifyManager = vi.fn(async () => undefined);
const milestoneCommitmentService = { reconcile: vi.fn(async () => new Set<string>()) };

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/lib/audit.js', () => ({ recordAgentAction }));
vi.mock('../src/services/managerNotifications.service.js', () => ({ maybeNotifyManager }));
vi.mock('../src/services/milestoneCommitment.service.js', () => ({
  milestoneCommitmentService,
  COMMITTED_VALUE: 'Committed',
}));

const { milestonesService } = await import('../src/services/milestones.service.js');

/** An existing milestone row as Prisma would return it. */
function existingMilestone(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ms-1',
    milestoneBusinessId: 'MS-001',
    milestoneName: 'Copilot rollout',
    opportunityId: 'opp-1',
    milestoneStatus: 'On Track',
    competitorName: null,
    ...overrides,
  };
}

/** The history row Prisma would return from the create inside the transaction. */
const historyRow = { id: 'sh-1', statusHistoryBusinessId: 'SH-001' };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.opportunityMilestone.findFirst.mockResolvedValue(existingMilestone());
  prismaMock.opportunityMilestone.update.mockReturnValue({ id: 'ms-1', milestoneStatus: 'Blocked' });
  prismaMock.milestoneStatusHistory.create.mockReturnValue(historyRow);
  maybeNotifyManager.mockResolvedValue(undefined);
});

describe('milestonesService.update — status history', () => {
  it('appends a history row when the status actually changes', async () => {
    await milestonesService.update('ms-1', { milestoneStatus: 'Blocked' });

    expect(prismaMock.milestoneStatusHistory.create).toHaveBeenCalledTimes(1);
    const { data } = prismaMock.milestoneStatusHistory.create.mock.calls[0][0];
    expect(data.oldStatus).toBe('On Track');
    expect(data.newStatus).toBe('Blocked');
    expect(data.milestone).toEqual({ connect: { id: 'ms-1' } });
    expect(data.opportunity).toEqual({ connect: { id: 'opp-1' } });
    expect(data.statusHistoryBusinessId).toMatch(/^SH-/);
    expect(data.statusDate).toBeInstanceOf(Date);
  });

  it('writes the milestone and its history in ONE transaction so they cannot diverge', async () => {
    await milestonesService.update('ms-1', { milestoneStatus: 'Blocked' });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    const ops = prismaMock.$transaction.mock.calls[0][0] as unknown[];
    expect(ops).toHaveLength(2);
    // The update must not be issued outside the transaction.
    expect(prismaMock.opportunityMilestone.update).toHaveBeenCalledTimes(1);
  });

  it('does NOT append history when the update leaves the status untouched', async () => {
    await milestonesService.update('ms-1', { comments: 'just a note' });

    expect(prismaMock.milestoneStatusHistory.create).not.toHaveBeenCalled();
    const ops = prismaMock.$transaction.mock.calls[0][0] as unknown[];
    expect(ops).toHaveLength(1);
  });

  it('does NOT append history when the status is re-submitted unchanged', async () => {
    await milestonesService.update('ms-1', { milestoneStatus: 'On Track' });

    expect(prismaMock.milestoneStatusHistory.create).not.toHaveBeenCalled();
  });

  it('records the acting human as changedBy when the caller supplies context', async () => {
    await milestonesService.update(
      'ms-1',
      { milestoneStatus: 'Blocked' },
      { changedBy: 'Dana Seller' },
    );

    const { data } = prismaMock.milestoneStatusHistory.create.mock.calls[0][0];
    expect(data.changedBy).toBe('Dana Seller');
  });

  it('falls back to the agent name for an approved agent UpdateMilestone action', async () => {
    // approvalRequestsService.executeAction stamps the agent via createdBy.
    await milestonesService.update('ms-1', {
      milestoneStatus: 'Blocked',
      createdBy: 'MilestoneAdvisor',
    });

    const { data } = prismaMock.milestoneStatusHistory.create.mock.calls[0][0];
    expect(data.changedBy).toBe('MilestoneAdvisor');
  });

  it('carries the status reason onto the history row', async () => {
    await milestonesService.update('ms-1', {
      milestoneStatus: 'Blocked',
      statusReason: 'Privacy review outstanding',
    });

    const { data } = prismaMock.milestoneStatusHistory.create.mock.calls[0][0];
    expect(data.reason).toBe('Privacy review outstanding');
  });

  it('still audits the change, and names the transition in the summary', async () => {
    await milestonesService.update('ms-1', { milestoneStatus: 'Blocked' });

    expect(recordAgentAction).toHaveBeenCalledTimes(1);
    const entry = recordAgentAction.mock.calls[0][0];
    expect(entry.actionType).toBe('Update');
    expect(entry.relatedMilestoneId).toBe('ms-1');
    expect(entry.inputSummary).toContain('On Track → Blocked');
  });

  it('refuses Lost To Competitor without a competitor, writing neither row', async () => {
    await expect(
      milestonesService.update('ms-1', { milestoneStatus: 'Lost To Competitor' }),
    ).rejects.toThrow();

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.milestoneStatusHistory.create).not.toHaveBeenCalled();
  });

  it('allows Lost To Competitor when a competitor is supplied, and records the transition', async () => {
    await milestonesService.update('ms-1', {
      milestoneStatus: 'Lost To Competitor',
      competitorName: 'AWS',
    });

    const { data } = prismaMock.milestoneStatusHistory.create.mock.calls[0][0];
    expect(data.newStatus).toBe('Lost To Competitor');
  });

  it('omits the opportunity link when the milestone has no parent opportunity', async () => {
    prismaMock.opportunityMilestone.findFirst.mockResolvedValue(
      existingMilestone({ opportunityId: null }),
    );

    await milestonesService.update('ms-1', { milestoneStatus: 'Blocked' });

    const { data } = prismaMock.milestoneStatusHistory.create.mock.calls[0][0];
    expect(data.opportunity).toBeUndefined();
    expect(data.milestone).toEqual({ connect: { id: 'ms-1' } });
  });

  it('throws 404 for an unknown milestone before writing anything', async () => {
    prismaMock.opportunityMilestone.findFirst.mockResolvedValue(null);

    await expect(milestonesService.update('nope', { milestoneStatus: 'Blocked' })).rejects.toThrow(
      /not found/i,
    );
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
