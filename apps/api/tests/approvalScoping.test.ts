import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Per-user scoping tests for the Approvals log.
 *
 * The rule: opportunities and milestones are shared by everyone, but agent
 * activity is personal. What your agent proposed — and the decision to actually
 * fire it — belongs to you alone.
 *
 * Deciding is the sharp edge here. A read leaks information, but an approval
 * EXECUTES the send or write, so letting one person decide another's request
 * would let them take a real action under someone else's name. These tests pin
 * that shut.
 *
 * Prisma is mocked, so the suite needs no database.
 */

const prismaMock = {
  approvalRequest: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
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
const { ownerScopeWhere, canAccessOwned } = await import('../src/lib/requestContext.js');

const ACTION_TAG = 'MSX_ACTION::';

const alice = { kind: 'user', oid: 'oid-alice' } as never;
const bob = { kind: 'user', oid: 'oid-bob' } as never;
const agent = { kind: 'service', appId: 'app-1' } as never;

/** An approval owned by Bob, carrying an action that would really send mail. */
function bobsRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'apr-1',
    approvalRequestBusinessId: 'APR-001',
    approvalStatus: 'Pending',
    requestStatus: 'Submitted',
    opportunityId: 'opp-1',
    relatedRecommendationId: null,
    relatedRecommendation: null,
    ownerId: 'oid-bob',
    errorMessage:
      ACTION_TAG + JSON.stringify({ kind: 'SendOutlookMail', to: 'x@example.com', subject: 'Hi', body: 'Body' }),
    ...overrides,
  };
}

function expectNothingExecuted() {
  for (const fn of [
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
  ]) {
    expect(fn).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.approvalRequest.update.mockImplementation(async ({ data }: any) => ({ id: 'apr-1', ...data }));
  // The service treats an undefined result as a failed action, so give the
  // executors something to hand back.
  graphService.sendMail.mockResolvedValue({ status: 'Sent' });
  graphService.notifyTeams.mockResolvedValue({ status: 'Sent' });
  graphService.notifyTenantTeams.mockResolvedValue({ status: 'Sent' });
});

describe('one user cannot act on another user\'s approval', () => {
  it('refuses to approve it, and executes nothing', async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValue(bobsRequest());

    await expect(
      approvalRequestsService.decide('apr-1', 'Approved', { reviewedBy: 'alice@example.com' } as never, alice),
    ).rejects.toThrow(/not found/i);

    expectNothingExecuted();
    expect(prismaMock.approvalRequest.update).not.toHaveBeenCalled();
  });

  it('refuses to reject it, so the owner still gets to decide', async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValue(bobsRequest());

    await expect(
      approvalRequestsService.decide('apr-1', 'Rejected', { reviewedBy: 'alice@example.com' } as never, alice),
    ).rejects.toThrow(/not found/i);

    expect(prismaMock.approvalRequest.update).not.toHaveBeenCalled();
  });

  it('hides it on read rather than admitting it exists', async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValue(bobsRequest());

    // 404-style "not found" instead of 403: a probe by id shouldn't confirm that
    // some other user has an approval sitting there.
    await expect(approvalRequestsService.get('apr-1', alice)).resolves.toBeNull();
  });

  it('refuses to update it', async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValue(bobsRequest());

    await expect(
      approvalRequestsService.update('apr-1', { requestName: 'renamed' } as never, alice),
    ).rejects.toThrow(/not found/i);

    expect(prismaMock.approvalRequest.update).not.toHaveBeenCalled();
  });
});

describe('the owner keeps full control of their own request', () => {
  it('lets Bob read his own request', async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValue(bobsRequest());

    const found = await approvalRequestsService.get('apr-1', bob);

    expect(found).not.toBeNull();
    expect(found?.pendingAction?.kind).toBe('SendOutlookMail');
  });

  it('lets Bob approve his own request, which performs the send', async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValue(bobsRequest());

    await approvalRequestsService.decide('apr-1', 'Approved', { reviewedBy: 'bob@example.com' } as never, bob);

    expect(graphService.sendMail).toHaveBeenCalledTimes(1);
  });
});

describe('seeded and system rows stay shared', () => {
  it('lets any signed-in user read an unowned row', async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValue(bobsRequest({ ownerId: null }));

    await expect(approvalRequestsService.get('apr-1', alice)).resolves.not.toBeNull();
  });

  it('still applies when auth is switched off for local dev', async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValue(bobsRequest());

    await expect(approvalRequestsService.get('apr-1', undefined)).resolves.not.toBeNull();
  });
});

describe('the read filter', () => {
  it('gives a signed-in user their own rows plus shared ones', () => {
    expect(ownerScopeWhere(alice)).toEqual({ OR: [{ ownerId: 'oid-alice' }, { ownerId: null }] });
  });

  it('gives the agent only shared rows when it carries no session handle', () => {
    // The agent authenticates with a service credential, which would otherwise
    // sail straight past a per-user filter and see everyone's activity.
    expect(ownerScopeWhere(agent)).toEqual({ ownerId: null });
  });

  it('scopes the agent to the user whose turn it is acting for', () => {
    expect(ownerScopeWhere(agent, 'oid-alice')).toEqual({
      OR: [{ ownerId: 'oid-alice' }, { ownerId: null }],
    });
  });

  it('applies no filter when auth is disabled', () => {
    expect(ownerScopeWhere(undefined)).toBeUndefined();
  });
});

describe('canAccessOwned', () => {
  it('blocks another user\'s row', () => {
    expect(canAccessOwned('oid-bob', alice)).toBe(false);
  });

  it('allows your own row', () => {
    expect(canAccessOwned('oid-alice', alice)).toBe(true);
  });

  it('allows shared rows', () => {
    expect(canAccessOwned(null, alice)).toBe(true);
  });

  it('blocks a user-owned row from a bare service call', () => {
    expect(canAccessOwned('oid-bob', agent)).toBe(false);
  });
});
