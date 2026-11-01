const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('crypto');
const {hashPassword,verifyPassword}=require('../lib/passwords');
const {createSessionStore}=require('../lib/session-store');
test('contraseñas nuevas con sal; las anteriores siguen verificándose para migrar',()=>{
  const password='contraseña ficticia';const a=hashPassword(password),b=hashPassword(password);
  assert.notEqual(a,b);assert.equal(verifyPassword(password,a,'unused'),true);assert.equal(verifyPassword('otra',a,'unused'),false);
  const legacy=crypto.createHmac('sha256','secret-local').update(password).digest('hex');
  assert.equal(verifyPassword(password,legacy,'secret-local'),true);assert.equal(verifyPassword(password,legacy,'wrong'),false);
  assert.equal(verifyPassword(password,'scrypt$bad$bad','unused'),false);
});
test('sesiones persistentes aisladas por rol, expiración y logout durable',async()=>{
  const rows=new Map();let now=Date.now();
  const pool={async query(sql,p=[]){
    if(sql.startsWith('CREATE'))return {rows:[]};
    if(sql.startsWith('INSERT')){rows.set(p[0],{token_hash:p[0],kind:p[1],payload:JSON.parse(p[2]),expires_at:p[3]});return {rows:[]};}
    if(sql.startsWith('SELECT'))return {rows:[...rows.values()]};
    if(sql.startsWith('DELETE FROM app_sessions WHERE token_hash'))rows.delete(p[0]);
    return {rows:[]};
  }};
  const first=createSessionStore(pool,{ttl:1000,clock:()=>now});await first.init();
  const token=await first.create('staff',{id:1,nombre:'Médica',rol:'medico'});
  assert.equal(first.staff[token].nombre,'Médica');assert.equal(first.companies[token],undefined);assert.equal(rows.has(token),false);
  const reboot=createSessionStore(pool,{ttl:1000,clock:()=>now});await reboot.init();assert.equal(reboot.staff[token].rol,'medico');
  now+=1001;assert.equal(reboot.staff[token],undefined);
  const next=await reboot.create('company',{id:2,nombre:'Empresa'});await reboot.remove('company',next);assert.equal(reboot.companies[next],undefined);
});
