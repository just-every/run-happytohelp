import {createFileRoute,redirect} from '@tanstack/react-router'
import {checkNativeSession} from '../ui/identity/loaders'

/** Business's declared link continues through native sign-in and workspace choice. */
export const Route=createFileRoute('/app/move-in')({
 headers:()=>({'Cache-Control':'no-store'}),
 beforeLoad:async({location})=>{
  const returnTo=location.pathname+location.searchStr,headers={'Cache-Control':'no-store'}
  const session=await checkNativeSession()
  if(!session)throw redirect({to:'/login',search:{returnTo},replace:true,headers})
  if('busy' in session)throw new Error('Workspace is temporarily busy. Reload to continue to Move in.')
  if(session.twoFactor)throw redirect({href:`/two-factor?returnTo=${encodeURIComponent(returnTo)}`,replace:true,headers})
  if(!session.projectId)throw redirect({href:'/projects?returnTo='+encodeURIComponent(returnTo),replace:true,headers})
  // Business links each tool's step here (importers.json): Zendesk's step opens Zendesk, every other the HappyToHelp export.
  const zendesk=new URLSearchParams(location.searchStr).get('from')==='zendesk'
  throw redirect({href:`/projects/${encodeURIComponent(session.projectId)}/move-in${zendesk?'':'?legacy=1'}`,replace:true,headers})
 },
})
