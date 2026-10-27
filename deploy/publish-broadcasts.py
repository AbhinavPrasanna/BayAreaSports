#!/usr/bin/env python3
"""Root-only application release, additive migration, cache validation and restore drill."""
import json,os,pathlib,re,subprocess,sys,tarfile,time,urllib.request
ROOT=pathlib.Path('/opt/bayline/deploy')
BASE=['docker','compose','--env-file','production.env','-f','compose.production.yaml']
def run(args,timeout=90,**kwargs):return subprocess.run(args,cwd=ROOT,check=True,capture_output=True,text=True,timeout=timeout,**kwargs).stdout
def sql(query,database='bayline'):return json.loads(run(BASE+['exec','-T','db','psql','-X','-v','ON_ERROR_STOP=1','-U','bayline','-d',database,'-Atc',query]))
def get(path):
 with urllib.request.urlopen('https://baylinescore.com'+path,timeout=15) as response:return json.load(response)
def state(service):
 cid=run(BASE+['ps','-q',service]).strip();item=json.loads(run(['docker','inspect',cid]))[0]
 return {'id':cid,'image':item['Config']['Image'],'started':item['State']['StartedAt'],'health':item['State'].get('Health',{}).get('Status')}
def save_env(value):
 target=ROOT/'production.env';tmp=target.with_name('production.env.status.tmp')
 fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 with os.fdopen(fd,'w') as stream:stream.write(value)
 os.replace(tmp,target)
def backup():return next(item for line in run(['python3','ops.py','backup'],300).splitlines() if (item:=json.loads(line)).get('event')=='backup_verified')
def main():
 if os.geteuid()!=0:raise RuntimeError('Root is required')
 release=json.load(sys.stdin);commit=release['sourceCommit'];images=release['images']
 assert re.fullmatch('[a-f0-9]{40}',commit)
 for name in ['web','worker']:assert re.fullmatch('221556120809.dkr.ecr.us-west-2.amazonaws.com/bayline-mvp-prod/'+name+'@sha256:[a-f0-9]{64}',images[name])
 before={s:state(s) for s in ['web','worker','db']};prebackup=backup()
 env=ROOT/'production.env';original=env.read_text();compose=ROOT/'compose.production.yaml';old_compose=compose.read_bytes()
 with tarfile.open('/tmp/bayline-broadcasts-deployment.tar') as archive:
  for member in archive.getmembers():
   assert (member.name=='deploy' or member.name.startswith('deploy/')) and '..' not in pathlib.PurePosixPath(member.name).parts and not member.name.startswith('/')
   assert member.isfile() or member.isdir()
  archive.extractall(ROOT.parent,filter='data')
 updates={'WEB_IMAGE':images['web'],'WORKER_IMAGE':images['worker']}
 updated=[]
 for line in original.splitlines():
  key=line.split('=',1)[0]
  if key in updates:updated.append(key+'='+updates.pop(key))
  else:updated.append(line)
 updated.extend(key+'='+value for key,value in updates.items())
 stage='migration'
 try:
  save_env('\n'.join(updated)+'\n');run(BASE+['config','--quiet'])
  run(BASE+['run','--rm','--no-deps','migrate'],180)
  stage='container-start';run(BASE+['up','-d','--no-deps','--wait','--wait-timeout','150','worker','web'],210)
  for name in ['web','worker']:assert state(name)['image']==images[name]
  stage='initial-broadcasts'
  # Catalog fallback is imported immediately; it does not wait for the next provider-score cycle.
  run(BASE+['run','--rm','--no-deps','migrate','node','dist-runtime/scripts/import-game-media.js'],90)
  for attempt in range(36):
   reports=sql("SELECT json_build_object('lastAttemptAt',last_attempt_at,'lastSuccessAt',last_success_at,'error',last_error_code,'nextCheckAt',next_check_at,'cachedGames',(SELECT count(*) FROM official_broadcasts WHERE expires_at>now())) FROM broadcast_sync_state WHERE source='nba-warriors'")
   if reports['lastAttemptAt'] and (reports['lastSuccessAt'] or reports['error']):break
   time.sleep(5)
  else:raise RuntimeError('Broadcast scheduler did not run; inspect bounded worker logs')
  if not reports['error'] and not reports['cachedGames']:raise RuntimeError('Official feed matched no stored Warriors games')
  after={s:state(s) for s in ['web','worker','db']};assert before['db']==after['db']
  stage='public-verification'
  samples=[]
  current=get('/api/games/nba/21717970')['data']
  if current['status'] in ['scheduled','in_progress']:
   if reports['error']:assert {'Peacock','NBC Sports Network'} <= {item['label'] for item in current['media']['broadcasts']}
   else:
    assert current['media']['broadcastSource']=='official_schedule'
    expected=sql("SELECT payload->'broadcasts' FROM official_broadcasts WHERE league='nba' AND provider_id=21717970")
    assert current['media']['broadcasts']==expected
  samples.append({'league':'nba','gameId':21717970,'status':current['status'],'networks':[item['label'] for item in current['media']['broadcasts']],'source':current['media'].get('broadcastSource'),'delayed':current['media'].get('broadcastDelayed',False)})
  for league,id in [('nba',21717859),('nfl',1392308),('wnba',1392716)]:
   game=get('/api/games/'+league+'/'+str(id))['data'];status=game['playerStatus']
   assert len(status)==1 and status[0]['status']==('disabled' if league=='wnba' else 'ready')
   if league!='wnba':assert status[0]['players'] and game['playerStats']['players']
   samples.append({'league':league,'players':len(status[0]['players']),'status':status[0]['status']})
  assert all('playerStatus' not in game for game in get('/api/games?league=all&view=results')['data'])
  stage='backup-restore';postbackup=backup();restored=json.loads(run(['python3','ops.py','restore'],300))
  counts_query="SELECT json_build_object('migrations',(SELECT count(*) FROM schema_migrations),'statusTeams',(SELECT count(*) FROM team_player_status WHERE enabled AND jsonb_array_length(payload)>0),'statusPlayers',(SELECT sum(jsonb_array_length(payload)) FROM team_player_status WHERE enabled),'playerGames',(SELECT count(*) FROM game_player_stats WHERE jsonb_array_length(payload)>0),'records',(SELECT count(*) FROM record_sync WHERE published_generation IS NOT NULL),'media',(SELECT count(*) FROM game_media),'automatic',(SELECT count(*) FROM youtube_highlights),'broadcasts',(SELECT count(*) FROM official_broadcasts),'broadcastState',(SELECT count(*) FROM broadcast_sync_state WHERE last_attempt_at IS NOT NULL));"
  restored_counts=sql(counts_query,restored['database']);assert restored_counts['migrations']==9 and restored_counts['statusTeams']==2 and restored_counts['statusPlayers']>0 and restored_counts['playerGames']>=7 and restored_counts['records']==6 and restored_counts['media']>=12 and restored_counts['automatic']>=2
  assert restored_counts['broadcastState']==1
  if not reports['error']:assert restored_counts['broadcasts']>0
  ready=get('/api/ready');assert ready['status']=='ok'
  settings={line.split('=',1)[0]:line.split('=',1)[1] for line in (ROOT/'production.env').read_text().splitlines() if '=' in line and line.split('=',1)[0] in {'WEB_IMAGE','WORKER_IMAGE','POSTGRES_IMAGE','CADDY_IMAGE','PLAYER_STATS_LEAGUES','PLAYER_STATUS_LEAGUES','HIGHLIGHTS_ENABLED','APP_DOMAIN','CADDY_CONFIG','COMPOSE_PROFILES','AWS_REGION','BACKUP_BUCKET'}}
  proof={'sourceCommit':commit,'images':images,'settings':settings,'before':before,'after':after,'reports':reports,'publicSamples':samples,'readiness':ready,'prebackup':prebackup,'backup':postbackup,'restore':restored,'restoredCounts':restored_counts}
  (ROOT/'evidence').mkdir(exist_ok=True);(ROOT/'evidence'/'broadcasts.json').write_text(json.dumps(proof,indent=2)+'\n')
  pathlib.Path('/tmp/bayline-broadcasts-manifest.json').write_text(json.dumps(proof,indent=2)+'\n')
  stage='recovery-archive'
  for name in ['source.zip','deployment.tar','manifest.json']:
   local='/tmp/bayline-broadcasts-'+name;key='releases/'+commit[:12]+'/'+name
   run(['aws','s3','cp',local,'s3://bayline-backups-221556120809-us-west-2/'+key,'--region','us-west-2','--only-show-errors'],120)
   size=json.loads(run(['aws','s3api','head-object','--bucket','bayline-backups-221556120809-us-west-2','--key',key,'--region','us-west-2','--query','ContentLength','--output','json']))
   assert size==pathlib.Path(local).stat().st_size
  print(json.dumps(proof))
 except Exception as error:
  compose.write_bytes(old_compose);save_env(original)
  try:run(BASE+['up','-d','--no-deps','--wait','--wait-timeout','150','worker','web'],210)
  except Exception:raise RuntimeError('Release failed at '+stage+'; automatic rollback also failed. Inspect service health.') from None
  raise RuntimeError('Release failed at '+stage+'; prior images/configuration restored; additive tables retained.') from None
if __name__=='__main__':
 try:main()
 except Exception as error:
  print(json.dumps({'event':'broadcasts_release_failed','message':str(error) if isinstance(error,RuntimeError) else 'Release verification failed; raw details omitted'}),file=sys.stderr);sys.exit(1)
