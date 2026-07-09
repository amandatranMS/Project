/**
 * MSX Milestone Assistant — database seed (SYNTHETIC MOCK DATA ONLY).
 *
 * All names, accounts, partners and competitors below are fictional and used
 * purely for demo purposes. No real MSX / customer data is referenced.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Resetting tables...');
  // Order matters because of FK constraints.
  await prisma.agentActionAuditLog.deleteMany();
  await prisma.agentRunLog.deleteMany();
  await prisma.agentNotification.deleteMany();
  await prisma.dashboardMetricSnapshot.deleteMany();
  await prisma.approvalRequest.deleteMany();
  await prisma.aiMilestoneRecommendation.deleteMany();
  await prisma.collaborationNote.deleteMany();
  await prisma.milestoneStatusHistory.deleteMany();
  await prisma.dealTeamMember.deleteMany();
  await prisma.opportunityMilestone.deleteMany();
  await prisma.opportunity.deleteMany();

  console.log('Seeding opportunities...');

  const contoso = await prisma.opportunity.create({
    data: {
      name: 'Contoso Cloud Modernization',
      accountName: 'Contoso Ltd',
      customerSegment: 'Enterprise',
      industry: 'Manufacturing',
      dealStage: 'Develop',
      estimatedValue: 850000,
      currency: 'USD',
      probability: 55,
      closeDate: new Date('2026-09-30'),
      owner: 'Jordan Alvarez',
      partnerName: 'Northwind Consulting',
      partnerType: 'SI',
      competitorName: 'Acme Cloud',
      competitorThreatLevel: 'Medium',
      riskLevel: 'Medium',
      riskNotes: 'Customer evaluating a competing hyperscaler for data workloads.',
      status: 'Open',
      dealTeamMembers: {
        create: [
          { memberName: 'Jordan Alvarez', email: 'jordan@example.com', role: 'Solution Engineer', isPrimary: true },
          { memberName: 'Priya Nair', email: 'priya@example.com', role: 'Account Executive' },
          { memberName: 'Sam Okafor', email: 'sam@example.com', role: 'Specialist' },
        ],
      },
    },
  });

  const fabrikam = await prisma.opportunity.create({
    data: {
      name: 'Fabrikam Data Platform',
      accountName: 'Fabrikam Inc',
      customerSegment: 'Commercial',
      industry: 'Retail',
      dealStage: 'Propose',
      estimatedValue: 420000,
      currency: 'USD',
      probability: 70,
      closeDate: new Date('2026-08-15'),
      owner: 'Mei Chen',
      partnerName: null,
      partnerType: 'None',
      competitorName: 'DataRival',
      competitorThreatLevel: 'High',
      riskLevel: 'High',
      riskNotes: 'Tight timeline; security review outstanding.',
      status: 'Open',
      dealTeamMembers: {
        create: [
          { memberName: 'Mei Chen', email: 'mei@example.com', role: 'Solution Engineer', isPrimary: true },
          { memberName: 'Diego Santos', email: 'diego@example.com', role: 'Manager' },
        ],
      },
    },
  });

  console.log('Seeding milestones...');

  const m1 = await prisma.opportunityMilestone.create({
    data: {
      opportunityId: contoso.id,
      title: 'Technical Win — Architecture Review',
      description: 'Validate target reference architecture with customer platform team.',
      milestoneType: 'Architecture Review',
      status: 'In Progress',
      priority: 'High',
      owner: 'Jordan Alvarez',
      dueDate: new Date('2026-07-25'),
      blockerDescription: 'Awaiting customer network diagrams.',
      blockerStatus: 'Open',
      riskAssessment: 'Medium risk: dependency on customer-provided artifacts.',
      riskScore: 45,
    },
  });

  const m2 = await prisma.opportunityMilestone.create({
    data: {
      opportunityId: contoso.id,
      title: 'Proof of Concept — Data Ingestion',
      description: 'Stand up POC ingesting sample telemetry.',
      milestoneType: 'POC',
      status: 'Not Started',
      priority: 'Medium',
      owner: 'Sam Okafor',
      dueDate: new Date('2026-08-20'),
      blockerStatus: 'None',
      riskScore: 20,
    },
  });

  const m3 = await prisma.opportunityMilestone.create({
    data: {
      opportunityId: fabrikam.id,
      title: 'Security Review',
      description: 'Complete security and compliance review with customer CISO office.',
      milestoneType: 'Security Review',
      status: 'At Risk',
      priority: 'Critical',
      owner: 'Mei Chen',
      dueDate: new Date('2026-07-18'),
      blockerDescription: 'Customer security questionnaire not yet returned.',
      blockerStatus: 'Mitigating',
      riskAssessment: 'High risk: blocks proposal sign-off.',
      riskScore: 80,
    },
  });

  console.log('Seeding status history...');
  await prisma.milestoneStatusHistory.createMany({
    data: [
      { milestoneId: m1.id, previousStatus: 'Not Started', newStatus: 'In Progress', changedBy: 'Jordan Alvarez', changeReason: 'Kickoff scheduled.' },
      { milestoneId: m3.id, previousStatus: 'In Progress', newStatus: 'At Risk', changedBy: 'Mei Chen', changeReason: 'Security questionnaire delayed.' },
    ],
  });

  console.log('Seeding collaboration notes...');
  await prisma.collaborationNote.createMany({
    data: [
      { opportunityId: contoso.id, authorName: 'Priya Nair', authorType: 'Human', noteText: 'Customer excited about modernization roadmap.', visibility: 'Team' },
      { milestoneId: m3.id, authorName: 'Mei Chen', authorType: 'Human', noteText: 'Escalated questionnaire to customer sponsor.', visibility: 'Team' },
    ],
  });

  console.log('Seeding an example agent recommendation + approval + audit trail...');
  const run = await prisma.agentRunLog.create({
    data: {
      agentName: 'MilestoneAdvisor',
      runType: 'Recommend',
      status: 'Succeeded',
      inputJson: JSON.stringify({ opportunityId: contoso.id }),
      outputJson: JSON.stringify({ recommendations: 1 }),
      completedAt: new Date(),
      durationMs: 1240,
    },
  });

  const rec = await prisma.aiMilestoneRecommendation.create({
    data: {
      opportunityId: contoso.id,
      milestoneId: m1.id,
      recommendationType: 'Next Milestone',
      title: 'Add a Deployment Readiness milestone',
      recommendationText: 'Create a "Deployment Readiness" milestone after the Architecture Review completes.',
      rationale: 'Deal stage is Develop with an architecture review in progress; a readiness gate reduces slippage.',
      confidenceScore: 0.82,
      generatedByAgent: 'MilestoneAdvisor',
      status: 'Submitted',
    },
  });

  const approval = await prisma.approvalRequest.create({
    data: {
      recommendationId: rec.id,
      milestoneId: m1.id,
      requestType: 'Create Milestone',
      requestedBy: 'MilestoneAdvisor',
      summary: 'Create "Deployment Readiness" milestone on Contoso Cloud Modernization.',
      payloadJson: JSON.stringify({
        opportunityId: contoso.id,
        title: 'Deployment Readiness',
        milestoneType: 'Deployment',
        priority: 'High',
        owner: 'Jordan Alvarez',
      }),
      status: 'Pending',
    },
  });

  await prisma.agentActionAuditLog.createMany({
    data: [
      { agentRunId: run.id, agentName: 'MilestoneAdvisor', actionType: 'ReadContext', entityType: 'Opportunity', entityId: contoso.id, outcome: 'Success', notes: 'Read opportunity + milestones for context.' },
      { agentRunId: run.id, agentName: 'MilestoneAdvisor', actionType: 'CreateRecommendation', entityType: 'Recommendation', entityId: rec.id, outcome: 'Success' },
      { agentRunId: run.id, agentName: 'MilestoneAdvisor', actionType: 'SubmitApproval', entityType: 'ApprovalRequest', entityId: approval.id, approvalRequestId: approval.id, outcome: 'Success', notes: 'Awaiting human approval before creating milestone.' },
    ],
  });

  console.log('Seeding notifications...');
  await prisma.agentNotification.createMany({
    data: [
      { recipient: 'Jordan Alvarez', notificationType: 'Approval Needed', title: 'Approval needed: new milestone', message: 'MilestoneAdvisor proposed a Deployment Readiness milestone.', relatedEntityType: 'ApprovalRequest', relatedEntityId: approval.id },
      { recipient: 'Mei Chen', notificationType: 'Recommendation', title: 'New recommendation available', message: 'Review the latest agent recommendations for Fabrikam.', relatedEntityType: 'Opportunity', relatedEntityId: fabrikam.id },
    ],
  });

  console.log('Seeding dashboard metric snapshots...');
  const openOpps = await prisma.opportunity.count({ where: { status: 'Open' } });
  const atRisk = await prisma.opportunityMilestone.count({ where: { status: 'At Risk' } });
  const pending = await prisma.approvalRequest.count({ where: { status: 'Pending' } });
  await prisma.dashboardMetricSnapshot.createMany({
    data: [
      { metricName: 'OpenOpportunities', metricValue: openOpps },
      { metricName: 'MilestonesAtRisk', metricValue: atRisk },
      { metricName: 'PendingApprovals', metricValue: pending },
    ],
  });

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
