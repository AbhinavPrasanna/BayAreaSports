#!/usr/bin/env python3
"""Web-only injury-report navigation release; preserve worker, database and subscriptions."""
import json,os,pathlib,re,subprocess,sys,urllib.request
ROOT=pathlib.Path('/opt/bayline/deploy')
BASE=['docker','compose','--env-file','production.env','-f','compose.production.yaml']
def run(args,timeout=90,**kwargs):return subprocess.run(args,cwd=ROOT,check=True,capture_output=True,text=True,timeout=timeout,**kwargs).stdout
def get(path):
 with urllib.request.urlopen('https://baylinescore.com'+path,timeout=15) as response:return json.load(response)
def state(service):
 cid=run(BASE+['ps','-q',service]).strip();item=json.loads(run(['docker','inspect',cid]))[0]
 return {'id':cid,'image':item['Config']['Image'],'started':item['State']['StartedAt'],'health':item['State'].get('Health',{}).get('Status')}
def save_env(value):
 target=ROOT/'production.env';tmp=target.with_name('production.env.injury-tab.tmp')
 fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 with os.fdopen(fd,'w') as stream:stream.write(value)
 os.replace(tmp,target)
def main():
 if os.geteuid()!=0:raise RuntimeError('Root is required')
 release=json.load(sys.stdin);commit=release['sourceCommit'];image=release['images']['web']
 assert re.fullmatch('[a-f0-9]{40}',commit)
 assert re.fullmatch('221556120809.dkr.ecr.us-west-2.amazonaws.com/bayline-mvp-prod/web@sha256:[a-f0-9]{64}',image)
 before={name:state(name) for name in ['web','worker','db']};original=(ROOT/'production.env').read_text()
 assert len(re.findall(r'^WEB_IMAGE=.*$',original,re.M))==1
 assert get('/api/ready')['status']=='ok'
 stage='web-start'
 try:
  save_env(re.sub(r'^WEB_IMAGE=.*$','WEB_IMAGE='+image,original,flags=re.M));run(BASE+['config','--quiet'])
  run(BASE+['up','-d','--no-deps','--wait','--wait-timeout','150','web'],210)
  after={name:state(name) for name in ['web','worker','db']}
  assert after['web']['image']==image and before['worker']==after['worker'] and before['db']==after['db']
  stage='public-verification'
  with urllib.request.urlopen('https://baylinescore.com/',timeout=20) as response:html=response.read().decode()
  assert 'href="#injury-report"' in html and 'Injury Report' in html
  reports=get('/api/player-status')['data'];assert len(reports)==3
  assert {row['league'] for row in reports}=={'nba','nfl','wnba'}
  for report in reports:
   assert report['status'] in (['disabled'] if report['league']=='wnba' else ['ready','delayed'])
   assert not report['players'] if report['league']=='wnba' else bool(report['players'])
  assert get('/api/games/nba/21717859')['data']['playerStats']['players']
  assert get('/api/games/nfl/1392308')['data']['playerStats']['players']
  assert get('/api/games/wnba/1392716')['data']['records']['finals']['gameNumber']==4
  stage='backup';backup=next(item for line in run(['python3','ops.py','backup'],300).splitlines() if (item:=json.loads(line)).get('event')=='backup_verified')
  ready=get('/api/ready');assert ready['status']=='ok' and all(ready['checks'].values())
  allowed={'WEB_IMAGE','WORKER_IMAGE','POSTGRES_IMAGE','CADDY_IMAGE','PLAYER_STATS_LEAGUES','PLAYER_STATUS_LEAGUES','HIGHLIGHTS_ENABLED','APP_DOMAIN','CADDY_CONFIG','COMPOSE_PROFILES','AWS_REGION','BACKUP_BUCKET'}
  settings={line.split('=',1)[0]:line.split('=',1)[1] for line in (ROOT/'production.env').read_text().splitlines() if '=' in line and line.split('=',1)[0] in allowed}
  proof={'sourceCommit':commit,'images':{'web':image,'worker':after['worker']['image']},'settings':settings,'before':before,'after':after,'reports':[{'league':r['league'],'players':len(r['players']),'status':r['status']} for r in reports],'readiness':ready,'backup':backup,'recovery':'No schema or worker change; existing migration-008 isolated restore remains applicable.'}
  stage='recovery-archive';pathlib.Path('/tmp/bayline-injury-tab-manifest.json').write_text(json.dumps(proof,indent=2)+'\n')
  for name in ['source.zip','deployment.tar','manifest.json']:
   local='/tmp/bayline-injury-tab-'+name;key='releases/'+commit[:12]+'/'+name
   run(['aws','s3','cp',local,'s3://bayline-backups-221556120809-us-west-2/'+key,'--region','us-west-2','--only-show-errors'],120)
   size=json.loads(run(['aws','s3api','head-object','--bucket','bayline-backups-221556120809-us-west-2','--key',key,'--region','us-west-2','--query','ContentLength','--output','json']))
   assert size==pathlib.Path(local).stat().st_size
  print(json.dumps(proof))
 except Exception:
  save_env(original)
  try:run(BASE+['up','-d','--no-deps','--wait','--wait-timeout','150','web'],210)
  except Exception:raise RuntimeError('Release failed at '+stage+'; web rollback also failed. Inspect service health.') from None
  raise RuntimeError('Release failed at '+stage+'; prior web image restored.') from None
if __name__=='__main__':
 try:main()
 except Exception as error:
  print(json.dumps({'event':'injury_tab_release_failed','message':str(error) if isinstance(error,RuntimeError) else 'Release verification failed; raw details omitted'}),file=sys.stderr);sys.exit(1)
