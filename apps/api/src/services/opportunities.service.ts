import { prisma } from '../lib/prisma.js';

const childInclude = {
  milestones: { orderBy: { milestoneBusinessId: 'asc' } },
  statusHistories: { orderBy: { statusDate: 'desc' } },
  recommendations: { orderBy: { recommendationBusinessId: 'asc' } },
  approvalRequests: { orderBy: { approvalRequestBusinessId: 'asc' } },
  collaborationNotes: { orderBy: { createdOn: 'desc' } },
  dealTeamMembers: { orderBy: { dealTeamMemberBusinessId: 'asc' } },
  notifications: { orderBy: { createdDate: 'desc' } },
  runLogs: { orderBy: { runName: 'asc' } },
  auditLogs: { orderBy: { createdAt: 'desc' } },
} as const;

export const opportunitiesService = {
  list(where: { status?: string; salesStage?: string; solutionArea?: string }) {
    return prisma.opportunity.findMany({
      where,
      orderBy: { opportunityBusinessId: 'asc' },
      include: { _count: { select: { milestones: true } } },
    });
  },

  get(id: string) {
    return prisma.opportunity.findUnique({
      where: { id },
      include: {
        milestones: { orderBy: { milestoneBusinessId: 'asc' } },
        dealTeamMembers: true,
        collaborationNotes: { orderBy: { createdOn: 'desc' } },
        recommendations: { orderBy: { recommendationBusinessId: 'asc' } },
      },
    });
  },

  /** Full 360° context: opportunity plus every related record. */
  context(id: string) {
    return prisma.opportunity.findUnique({ where: { id }, include: childInclude });
  },
};
