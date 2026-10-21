/**
 * Read-only version check for Gemini sandbox admin.
 * GitHub public branch is a source candidate, NOT evidence of deployment.
 * Never merges, deploys, or opens business ledgers.
 */
const GITHUB_BRANCH='prototype/customer-ai-gemini-free-20261020';
const GITHUB_API='https://api.github.com/repos/nguyenkhoilevn7-acetropical/Minhsatori/branches/'+encodeURIComponent(GITHUB_BRANCH);
const sha=value=>/^[a-f0-9]{7,40}$/i.test(String(value||'').trim())?String(value).trim().toLowerCase():null;
let cached=null,updatedAt=0;

export function compareVersion(deployed,source) {
 const run=sha(deployed),head=sha(source);
 if(!run||!head)return 'unverified';
 return run===head||run.length>=7&&head.length>=7&&
   (run.length===40&&head.length<40?run.startsWith(head):
   head.length===40&&run.length<40?head.startsWith(run):false)
   ?'up_to_date':'update_available';
}

export async function getGeminiVersionStatus({
 env=process.env,fetcher=globalThis.fetch,now=Date.now(),cache=true
}={}) {
 const deployed=sha(env.RENDER_GIT_COMMIT)||sha(env.SATORI_BUILD_COMMIT);
 if(cache&&cached&&now-updatedAt>=0&&now-updatedAt<120000)
   return {...cached,gemini:{...cached.gemini,deployedCommit:deployed,
     state:compareVersion(deployed,cached.gemini.githubCommit)}};
 let githubCommit=null,githubReachable=false;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4500);
 try {
  const res=await fetcher(GITHUB_API,{
   method:'GET',headers:{'Accept':'application/vnd.github+json',
    'User-Agent':'minh-satori-sandbox-version-status'},
   signal:controller.signal
  });
  if(res.ok){
   const json=await res.json();
   githubCommit=sha(json?.commit?.sha);
   githubReachable=Boolean(githubCommit);
  }
 }catch{}
 finally{clearTimeout(timer)}
 const answer={
  checkedAt:new Date(now).toISOString(),
  gemini:{branch:GITHUB_BRANCH,deployedCommit:deployed,
   githubCommit,githubReachable,state:compareVersion(deployed,githubCommit)},
  android:{state:'not_verified',note:'Thay giao diện/mã Android cần bản APK phát hành mới.'},
  website:{state:'not_verified',note:'Chưa xác minh đồng bộ production end-to-end.'}
 };
 if(cache){cached=answer;updatedAt=now}
 return answer;
}
