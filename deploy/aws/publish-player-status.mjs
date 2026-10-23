// Run from the owner's normal PowerShell session; never paste keys into chat.
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {aws,connection} from './remote.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const injuryTab=process.argv.includes('--injury-tab');
const releaseName=injuryTab?'injury-tab':'player-status';
const scratch=join(repo,'.secrets',releaseName+'-release');mkdirSync(scratch,{recursive:true,mode:0o700});
function git(args){const r=spawnSync('git',['-c','safe.directory='+repo.replaceAll('\\','/'),...args],{cwd:repo,encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error('Git source preparation failed; details omitted');return r.stdout.trim();}
function command(args){const r=spawnSync('aws',args,{encoding:'utf8',windowsHide:true,timeout:180000});if(r.status!==0)throw Error('Source upload failed; details omitted');}
function protectIdentity(){
 const identity=join(scratch,'ssh','identity');if(process.platform!=='win32'||!existsSync(identity))return;
 const quote=value=>"'"+value.replaceAll("'","''")+"'";
 const source=`$ErrorActionPreference='Stop';Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1');Add-Type -AssemblyName System.Security;$p=${quote(identity)};$b=[IO.File]::ReadAllBytes($p);try{[IO.File]::WriteAllBytes($p,[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))}finally{[Array]::Clear($b,0,$b.Length)}`;
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(source,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true});
 if(r.status!==0)throw Error('Could not encrypt temporary SSH identity; keep its restricted directory secure.');
}
try{
 if(aws(['sts','get-caller-identity']).Account!=='221556120809')throw Error('Sign in to the existing Bayline AWS account first.');
 if(git(['status','--porcelain']))throw Error('Commit or set aside local changes before publishing.');
 const sha=git(['rev-parse','HEAD']);if(!/^[a-f0-9]{40}$/.test(sha))throw Error('Invalid source commit');
 const source=join(scratch,'source.zip'),deployment=join(scratch,'deployment.tar');
 git(['archive','--format=zip','--output='+source,'HEAD']);git(['archive','--format=tar','--output='+deployment,'HEAD','deploy']);
 const remote=connection('bayline-mvp-prod-01',join(scratch,'ssh'));
 let coverage=null;
 if(!injuryTab){
 console.log('Validating NBA/NFL current rosters and injury reports with the existing server-only key...');
 const probe=readFileSync(join(repo,'deploy','probe-player-status.cjs'),'utf8');
 const py=`import subprocess\nr=subprocess.run(['docker','compose','--env-file','production.env','-f','compose.production.yaml','exec','-T','worker','node','-'],input=${JSON.stringify(probe)},cwd='/opt/bayline/deploy',capture_output=True,text=True,timeout=300)\nif r.returncode: raise SystemExit(r.stderr.strip() or 'Coverage validation failed; raw details omitted')\nprint(r.stdout)`;
 const checked=remote.exec('sudo python3 -',{input:py,timeout:330000});
 if(checked.status!==0)throw Error(checked.stderr.trim().slice(-350)||'Coverage validation failed; no subscription was changed');
 coverage=JSON.parse(checked.stdout);writeFileSync(join(scratch,'coverage.json'),JSON.stringify(coverage,null,2)+'\n');console.log(JSON.stringify(coverage));
 }
 const tag=sha.slice(0,12),sourceLocation='bayline-mvp-prod-sourcebucket-tgkeygxfqp28/source/'+tag+'.zip';
 command(['s3','cp',source,'s3://'+sourceLocation,'--region','us-west-2','--only-show-errors']);
 const build=aws(['codebuild','start-build','--project-name','bayline-mvp-prod','--source-location-override',sourceLocation,'--environment-variables-override',JSON.stringify([{name:'IMAGE_TAG',value:tag,type:'PLAINTEXT'}])]).build;
 writeFileSync(join(scratch,'build.json'),JSON.stringify({id:build.id,sourceCommit:sha,tag},null,2)+'\n');
 console.log('Production build started: '+build.id);
 let previous='';
 for(let attempt=0;;attempt++){
  const current=aws(['codebuild','batch-get-builds','--ids',build.id]).builds[0];
  if(current.currentPhase!==previous){console.log('Build: '+current.currentPhase);previous=current.currentPhase;}
  if(current.buildStatus==='SUCCEEDED')break;
  if(current.buildStatus!=='IN_PROGRESS'||attempt>=80)throw Error('Production build did not succeed; live services were not changed');
  await sleep(20000);
 }
 const registry='221556120809.dkr.ecr.us-west-2.amazonaws.com',images={};
 for(const name of (injuryTab?['web']:['web','worker'])){
  const digest=aws(['ecr','describe-images','--repository-name','bayline-mvp-prod/'+name,'--image-ids','imageTag='+tag]).imageDetails[0].imageDigest;
  if(!/^sha256:[a-f0-9]{64}$/.test(digest))throw Error('Invalid image digest');images[name]=registry+'/bayline-mvp-prod/'+name+'@'+digest;
 }
 try{
  const token=aws(['ecr','get-authorization-token']).authorizationData[0].authorizationToken;
  const password=Buffer.from(token,'base64').toString('utf8').replace(/^AWS:/,'');
  if(remote.exec(`sudo docker login --username AWS --password-stdin ${registry}`,{input:password}).status!==0)throw Error('Image registry sign-in failed');
  for(const image of Object.values(images))if(remote.exec('sudo docker pull '+image,{timeout:180000}).status!==0)throw Error('Image pull failed');
 }finally{remote.exec('sudo docker logout '+registry);}
 remote.copy(source,`/tmp/bayline-${releaseName}-source.zip`);remote.copy(deployment,`/tmp/bayline-${releaseName}-deployment.tar`);
 remote.copy(join(repo,'deploy',`publish-${releaseName}.py`),`/tmp/bayline-publish-${releaseName}.py`);
 console.log(injuryTab?'Deploying the prebuilt web image and checking cached reports; worker and database stay running...':'Deploying prebuilt images, applying migration 008, and waiting for current reports...');
 const published=remote.exec(`sudo python3 /tmp/bayline-publish-${releaseName}.py`,{input:JSON.stringify({sourceCommit:sha,images}),timeout:1200000});
 if(published.status!==0)throw Error(published.stderr.trim().slice(-800)||'Production verification failed; inspect service health');
 const proof=JSON.parse(published.stdout);proof.coverage=coverage;proof.buildId=build.id;
 const evidence=join(repo,'deploy','evidence');mkdirSync(evidence,{recursive:true});
 writeFileSync(join(evidence,releaseName+'-release.json'),JSON.stringify(proof,null,2)+'\n');
 console.log(JSON.stringify({status:'deployed',url:'https://baylinescore.com/'+(injuryTab?'#injury-report':''),sourceCommit:sha,reports:proof.reports,readiness:proof.readiness,restore:proof.restore,evidence:'deploy/evidence/'+releaseName+'-release.json'},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
finally{protectIdentity();}
