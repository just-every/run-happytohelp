import {phases} from '../journeys/kit/scenarios.mjs';
import {credentials,reads,money,uncertainty,erasure} from '../helpers/business-connectors/journeys.mjs';
const phase=phases(import.meta.url);
phase('business credentials retain workspace custody and step-up authority',credentials);
phase('business reads retain explicit source mapping, freshness and provider isolation',reads);
phase('business actions require exact bounded approval and provider readback',money);
phase('business uncertainty never replays money and reconciles provider state',uncertainty);
phase('business erasure prevents mapped context and actions from returning',erasure);
