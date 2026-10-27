import {suggestProblems,previewSuggestion,decideSuggestion} from './problem-suggestions'
import {Hono} from 'hono'
import type {AppEnv} from '../../platform/env'
import {dashboardAccess} from '../management/dashboard'
import {readProblem} from './problem-model'
import {markProblem,linkIncidents} from './problem-links'
import {previewProblemSolve} from './problem-preview'
import {executeProblemSolve,problemSolveResults} from './problem-execute'
export const problemRoutes=new Hono<AppEnv>()
const path='/projects/:projectId/conversations/:conversationId/ticket/problem'
const authority=(c:any)=>({sessionHash:c.get('sessionHash'),source:'dashboard' as const})
problemRoutes.get(path,async c=>{const {actor,conversation}=await dashboardAccess(c);return c.json({data:await readProblem(c.env,actor,conversation.id,authority(c),Number(c.req.query('incident_offset')||0))})})
problemRoutes.patch(path,async c=>{const {actor,conversation}=await dashboardAccess(c);return c.json({data:await markProblem(c.env,actor,conversation.id,await c.req.json(),authority(c))})})
for(const mode of ['preview','apply'] as const)problemRoutes.post(`${path}/incidents/${mode}`,async c=>{const {actor,conversation}=await dashboardAccess(c);return c.json({data:await linkIncidents(c.env,actor,conversation.id,await c.req.json(),authority(c),mode==='apply')})})
problemRoutes.post(`${path}/solve/preview`,async c=>{const {actor,conversation}=await dashboardAccess(c);return c.json({data:await previewProblemSolve(c.env,actor,conversation.id,await c.req.json(),authority(c))})})
problemRoutes.post(`${path}/solve/apply`,async c=>{const {actor,conversation}=await dashboardAccess(c),input=await c.req.json();return c.json({data:await executeProblemSolve(c.env,actor,conversation.id,input.preview_id,authority(c))})})
problemRoutes.get(`${path}/solve/:previewId`,async c=>{const {actor,conversation}=await dashboardAccess(c);return c.json({data:await problemSolveResults(c.env,actor,conversation.id,c.req.param('previewId'),authority(c))})})

problemRoutes.get(`${path}/suggestions`,async c=>{const {actor,conversation}=await dashboardAccess(c);return c.json({data:await suggestProblems(c.env,actor,conversation.id,authority(c))})})
problemRoutes.post(`${path}/suggestions/preview`,async c=>{const {actor,conversation}=await dashboardAccess(c);return c.json({data:await previewSuggestion(c.env,actor,conversation.id,await c.req.json(),authority(c))})})
for(const decision of ['confirm','reject'] as const)problemRoutes.post(`${path}/suggestions/${decision}`,async c=>{const {actor,conversation}=await dashboardAccess(c);return c.json({data:await decideSuggestion(c.env,actor,conversation.id,await c.req.json(),authority(c),decision==='confirm')})})
