const crypto=require('crypto');
const digest=token=>crypto.createHash('sha256').update(String(token)).digest('hex');
function createSessionStore(pool,{ttl=12*60*60*1000,clock=Date.now}={}) {
  const staff=new Map(),companies=new Map();
  function view(map){return new Proxy(Object.create(null),{
    get(_target,token){if(typeof token!=='string')return undefined;const entry=map.get(digest(token));if(!entry)return undefined;
      if(entry.until<=clock()){map.delete(digest(token));return undefined;}return entry.user;},
    deleteProperty(_target,token){map.delete(digest(token));pool.query('DELETE FROM app_sessions WHERE token_hash=$1',[digest(token)]).catch(()=>{});return true;},
    ownKeys(){return [];}
  });}
  async function init(){
    await pool.query(`CREATE TABLE IF NOT EXISTS app_sessions(token_hash TEXT PRIMARY KEY,kind TEXT NOT NULL,payload JSONB NOT NULL,expires_at TIMESTAMPTZ NOT NULL)`);
    await pool.query('DELETE FROM app_sessions WHERE expires_at<=NOW()');
    const rows=(await pool.query('SELECT * FROM app_sessions WHERE expires_at>NOW()')).rows;
    for(const row of rows)(row.kind==='company'?companies:staff).set(row.token_hash,{user:row.payload,until:new Date(row.expires_at).getTime()});
  }
  async function create(kind,user){
    const token=crypto.randomBytes(32).toString('hex'),until=clock()+ttl;
    await pool.query('INSERT INTO app_sessions(token_hash,kind,payload,expires_at) VALUES ($1,$2,$3,$4)',[digest(token),kind,JSON.stringify(user),new Date(until)]);
    (kind==='company'?companies:staff).set(digest(token),{user,until});return token;
  }
  // Rare profile edits must also update persisted sessions, otherwise a restart restores
  // an old display name and loses turn assignments. Call explicitly after those edits.
  async function updateUser(kind,id,patch){
    const map=kind==='company'?companies:staff;
    for(const [key,entry] of map)if(entry.user.id===id){Object.assign(entry.user,patch);await pool.query('UPDATE app_sessions SET payload=$1 WHERE token_hash=$2',[JSON.stringify(entry.user),key]);}
  }
  async function renameStaff(oldName,newName){
    for(const [key,entry] of staff)if(entry.user.nombre===oldName){entry.user.nombre=newName;await pool.query('UPDATE app_sessions SET payload=$1 WHERE token_hash=$2',[JSON.stringify(entry.user),key]);}
  }
  async function remove(kind,token){await pool.query('DELETE FROM app_sessions WHERE token_hash=$1',[digest(token)]);(kind==='company'?companies:staff).delete(digest(token));}
  // Cierra todas las sesiones de una cuenta (cambio o recuperación de contraseña). `except`
  // conserva la sesión desde la que se hizo el cambio.
  async function removeByEmail(kind,email,except){
    const map=kind==='company'?companies:staff,keep=except?digest(except):null,target=String(email||'').toLowerCase();
    for(const [key,entry] of map)if(key!==keep&&String(entry.user.email||'').toLowerCase()===target){map.delete(key);await pool.query('DELETE FROM app_sessions WHERE token_hash=$1',[key]);}
  }
  return {init,create,updateUser,renameStaff,remove,removeByEmail,staff:view(staff),companies:view(companies)};
}
module.exports={createSessionStore};
