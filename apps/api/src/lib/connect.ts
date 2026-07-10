/**
 * Helpers that turn friendly lookup values (names / business ids) into Prisma
 * `connect` clauses against the @unique keys defined in the schema.
 */
export function connectOpportunity(name?: string | null) {
  return name ? { connect: { opportunityName: name } } : undefined;
}
export function connectMilestone(businessId?: string | null) {
  return businessId ? { connect: { milestoneBusinessId: businessId } } : undefined;
}
export function connectRecommendation(businessId?: string | null) {
  return businessId ? { connect: { recommendationBusinessId: businessId } } : undefined;
}
