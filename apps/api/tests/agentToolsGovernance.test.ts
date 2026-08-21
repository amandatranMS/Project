import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression tests for the in-app TS engine's agent tools.
 *
 * The agent must never mutate business data directly — every write goes through
 * an ApprovalRequest that a human decides on. `update_milestone` and
 * `delete_milestone` previously called milestonesService directly, silently
 * bypassing that gate whenever IN_APP_ENGINE_ENABLED was turned on. These tests
 * lock the fix in place.
 */

const milestonesService = { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() };
const opportunitiesService = { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), createForApproval: vi.fn() };
const recommendationsService = { create: vi.fn() };
const approvalRequestsService = { create: vi.fn() };
const dashboardService = { summary: vi.fn() };
const handoffService = { readiness: vi.fn() };
const searchService = { search: vi.fn(), entityKeys: vi.fn(() => ['opportunity', 'milestone']) };

vi.mock('../src/services/milestones.service.js', () => ({ milestonesService }));
vi.mock('../src/services/opportunities.service.js', () => ({ opportunitiesService }));
vi.mock('../src/services/recommendations.service.js', () => ({ recommendationsService }));
vi.mock('../src/services/approvalRequests.service.js', () => ({ approvalRequestsService }));
vi.mock('../src/services/dashboard.service.js', () => ({ dashboardService }));
vi.mock('../src/services/handoff.service.js', () => ({ handoffService }));
vi.mock('../src/services/search.service.js', () => ({ searchService }));

const { milestoneTools, opportunityTools } = await import('../src/services/chat/msxTools.js');

const tool = (name: string) => {
  const found = [...milestoneTools, ...opportunityTools].find((t) => t.name === name);
  if (!found) throw new Error(`Tool ${name} not found`);
  return found;
};

/** Every service call that would be a real, ungoverned write. */
function expectNoDirectWrite() {
  expect(milestonesService.create).not.toHaveBeenCalled();
  expect(milestonesService.update).not.toHaveBeenCalled();
  expect(milestonesService.remove).not.toHaveBeenCalled();
  expect(opportunitiesService.create).not.toHaveBeenCalled();
  expect(opportunitiesService.update).not.toHaveBeenCalled();
  expect(opportunitiesService.createForApproval).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  approvalRequestsService.create.mockResolvedValue({
    approvalRequestBusinessId: 'APR-100',
    approvalStatus: 'Pending',
  });
  recommendationsService.create.mockResolvedValue({ recommendationBusinessId: 'REC-1' });
  milestonesService.get.mockResolvedValue({ id: 'ms-1', opportunity: { opportunityName: 'Contoso Migration' } });
});

describe('in-app agent tools — update_milestone is approval-gated', () => {
  it('submits an approval request instead of updating the milestone', async () => {
    const result = (await tool('update_milestone').run({ id: 'ms-1', milestoneStatus: 'Completed' })) as Record<string, unknown>;

    expectNoDirectWrite();
    expect(approvalRequestsService.create).toHaveBeenCalledTimes(1);
    expect(result.submittedForApproval).toBe(true);
    expect(result.approvalRequestBusinessId).toBe('APR-100');
  });

  it('encodes an UpdateMilestone action carrying the proposed fields', async () => {
    await tool('update_milestone').run({ id: 'ms-1', milestoneStatus: 'Completed', owner: 'Alex' });

    const { action } = approvalRequestsService.create.mock.calls[0][0];
    expect(action).toMatchObject({ kind: 'UpdateMilestone', milestoneId: 'ms-1', milestoneStatus: 'Completed', owner: 'Alex' });
  });

  it('attaches the parent opportunity so the approval shows its deal', async () => {
    await tool('update_milestone').run({ id: 'ms-1', milestoneStatus: 'Completed' });

    expect(approvalRequestsService.create.mock.calls[0][0].opportunityName).toBe('Contoso Migration');
  });

  it('still queues the approval when the opportunity lookup fails', async () => {
    milestonesService.get.mockRejectedValue(new Error('db down'));

    const result = (await tool('update_milestone').run({ id: 'ms-1', milestoneStatus: 'Completed' })) as Record<string, unknown>;

    expect(result.submittedForApproval).toBe(true);
    expect(approvalRequestsService.create.mock.calls[0][0].opportunityName).toBeUndefined();
  });
});

describe('in-app agent tools — delete_milestone is approval-gated', () => {
  it('submits an approval request instead of deleting the milestone', async () => {
    const result = (await tool('delete_milestone').run({ id: 'ms-9' })) as Record<string, unknown>;

    expectNoDirectWrite();
    expect(approvalRequestsService.create).toHaveBeenCalledTimes(1);
    expect(approvalRequestsService.create.mock.calls[0][0].action).toMatchObject({
      kind: 'DeleteMilestone',
      milestoneId: 'ms-9',
    });
    expect(result.submittedForApproval).toBe(true);
  });
});

describe('in-app agent tools — creates stay approval-gated', () => {
  it('create_milestone submits a recommendation plus an approval, and writes nothing', async () => {
    const result = (await tool('create_milestone').run({
      userConfirmed: true,
      milestoneName: 'Design review',
      opportunityName: 'Contoso Migration',
      competitorBlankConfirmed: true,
    })) as Record<string, unknown>;

    expectNoDirectWrite();
    expect(approvalRequestsService.create).toHaveBeenCalledTimes(1);
    expect(result.submittedForApproval).toBe(true);
  });

  it('create_milestone refuses to act without explicit user confirmation', async () => {
    await expect(
      tool('create_milestone').run({
        userConfirmed: false,
        milestoneName: 'Design review',
        opportunityName: 'Contoso Migration',
        competitorBlankConfirmed: true,
      }),
    ).rejects.toThrow(/confirmation/i);

    expect(approvalRequestsService.create).not.toHaveBeenCalled();
    expectNoDirectWrite();
  });

  it('create_opportunity submits an approval and writes nothing', async () => {
    const result = (await tool('create_opportunity').run({
      userConfirmed: true,
      opportunityName: 'Fabrikam Expansion',
    })) as Record<string, unknown>;

    expectNoDirectWrite();
    expect(approvalRequestsService.create.mock.calls[0][0].action).toMatchObject({ kind: 'CreateOpportunity' });
    expect(result.submittedForApproval).toBe(true);
  });
});

describe('in-app agent tools — no mutating tool escapes the gate', () => {
  const mutatingTools = ['create_milestone', 'update_milestone', 'delete_milestone', 'create_opportunity'];

  it.each(mutatingTools)('%s reports submittedForApproval and performs no direct write', async (name) => {
    const args: Record<string, unknown> = {
      create_milestone: { userConfirmed: true, milestoneName: 'M', opportunityName: 'Contoso Migration', competitorBlankConfirmed: true },
      update_milestone: { id: 'ms-1', milestoneStatus: 'Completed' },
      delete_milestone: { id: 'ms-1' },
      create_opportunity: { userConfirmed: true, opportunityName: 'Fabrikam Expansion' },
    }[name] as Record<string, unknown>;

    const result = (await tool(name).run(args)) as Record<string, unknown>;

    expect(result.submittedForApproval).toBe(true);
    expectNoDirectWrite();
  });
});
