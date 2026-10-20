import {decryptToken} from './secrets'
import type {Env} from '../../platform/env'

export type GithubCredentialMode = 'oauth' | 'mapped' | 'single'
export type GithubCredential = {mode:GithubCredentialMode;token:string}

export async function githubCredential(env:Env,projectId:string):Promise<GithubCredential|undefined>{
 const connection=await env.DB.prepare('SELECT token_cipher FROM github_connections WHERE project_id=?').bind(projectId).first<{token_cipher:string}>()
 if(connection)return {mode:'oauth',token:await decryptToken(env,projectId,connection.token_cipher)}
 if(typeof env.GITHUB_TOKENS==='string'){
  try{
   const value=JSON.parse(env.GITHUB_TOKENS)[projectId]
   if(typeof value==='string'&&value)return {mode:'mapped',token:value}
  }catch{throw new Error('Invalid GitHub credential map')}
 }
 if(env.GITHUB_PROJECT_ID===projectId&&typeof env.GITHUB_TOKEN==='string'&&env.GITHUB_TOKEN)return {mode:'single',token:env.GITHUB_TOKEN}
 return undefined
}

export async function githubToken(env:Env,projectId:string):Promise<string|undefined>{return (await githubCredential(env,projectId))?.token}

export function githubApiHeaders(token:string){return {Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','User-Agent':'HappyToHelp-native','X-GitHub-Api-Version':'2022-11-28'}}

export function githubApiRequest(path:string,token:string){return fetch(`https://api.github.com/${path}`,{headers:githubApiHeaders(token),redirect:'manual',signal:AbortSignal.timeout(15000)})}

/** Issue writes have a separate, workspace-installed credential; repository reads keep their existing authority. */
export {createIssue as createGithubEscalation,getIssue as readGithubEscalation} from '../escalations/providers'
