// Runs only inside the existing worker. Secrets remain in mounted files/memory.
const fs=require('node:fs');
const {Client}=require('pg');
const db=new Client({connectionString:fs.readFileSync(process.env.DATABASE_URL_FILE,'utf8').trim()});
const key=fs.readFileSync(process.env.BALLDONTLIE_API_KEY_FILE,'utf8').trim();
(async()=>{
 await db.connect();const results=[];
 for(const [league,teamId] of [['nba',10],['nfl',30]])for(const kind of ['players/active','player_injuries']){
  const prefix=league==='nba'?'v1':`${league}/v1`;
  let cursor;const seen=new Set(),ids=new Set();let count=0;
  for(let page=0;;page++){
   if(page>=4)throw Error('Coverage pagination exceeded its bound');
   const slot=(await db.query("UPDATE provider_throttle SET next_request_at=GREATEST(next_request_at,clock_timestamp())+interval '14 seconds' WHERE provider='balldontlie' RETURNING next_request_at-interval '14 seconds' AS allowed_at")).rows[0].allowed_at;
   await new Promise(resolve=>setTimeout(resolve,Math.max(0,slot.getTime()-Date.now())));
   const url=new URL(`https://api.balldontlie.io/${prefix}/${kind}`);url.searchParams.set('team_ids[]',String(teamId));url.searchParams.set('per_page','100');if(cursor!==undefined)url.searchParams.set('cursor',String(cursor));
   const response=await fetch(url,{headers:{Authorization:key},redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error(`${league} ${kind} returned HTTP ${response.status}; access must be resolved before activation`);
   const body=await response.json();if(!Array.isArray(body.data))throw Error('Coverage page shape is invalid');
   for(const row of body.data){const p=kind==='player_injuries'?row.player:row;
    if(!p||!Number.isInteger(p.id)||(p.team_id??p.team?.id)!==teamId||typeof p.first_name!=='string'||typeof p.last_name!=='string')throw Error('Coverage row failed player/team validation');
    ids.add(p.id);count++;
   }
   const next=body.meta?.next_cursor;if(next===null||next===undefined)break;
   if(!Number.isInteger(next)||seen.has(next))throw Error('Coverage cursor is invalid');seen.add(next);cursor=next;
  }
  if(kind==='players/active'&&!count)throw Error('Current roster is empty');
  results.push({league,teamId,kind,rows:count,players:ids.size});
 }
 console.log(JSON.stringify({coverageValidated:true,results}));
})().catch(error=>{console.error(error.message?.startsWith('nba ')||error.message?.startsWith('nfl ')?error.message:'Coverage validation failed; request details omitted');process.exitCode=1;}).finally(()=>db.end());
