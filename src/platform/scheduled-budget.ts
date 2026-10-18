/** One scheduled invocation, including all three parallel consumers. Each share
 * includes discovery and the largest admitted unit's outcome writes. Keep fixed
 * shares across the parallel branches: one branch cannot borrow credit another
 * may already have admitted. Sequential phases within a branch do share credit. */
export const scheduledReservations={jobs:940,notifications:54,audit:6} as const
