import {getPool} from '@/server/db/pool';
import {readFollowedPlayerStatus} from '@/server/db/player-status';

export const dynamic='force-dynamic';
export async function GET(){
  const headers={'Cache-Control':'no-store'};
  try{return Response.json({data:await readFollowedPlayerStatus(getPool())},{headers});}
  catch{return Response.json({error:'Player reports are temporarily unavailable.'},{status:503,headers});}
}
