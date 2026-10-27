import {any,either,journeys} from '../journeys/kit/scenarios.mjs';
for(const module of ['api','api-create','native-boundary','docs','emitted','delivery','slack','migration'])await import(`./${module}.mjs`);

// Connections journeys and the scenarios each owns, through the real API, settings and dispatcher doors.
export const claims={
 credentials:['native settings require current native authority, never a machine credential',any('native-boundary')],
 api:['API credential lifecycle: issue, use scoped operations, paginate, refuse lost authority and erasure, then revoke',either(any('api'),any('docs'),any('emitted'),any('api-create'))],
 delivery:['delivery lifecycle: prepare, sign, dispatch, recover bounded work and require fresh approval for uncertain resend',any('delivery')],
 slack:['Slack notifications stay tenant scoped and imported history stays inert across upgrade',either(any('slack'),any('migration'))],
};
export const journey=journeys(claims);
