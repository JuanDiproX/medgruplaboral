const crypto=require('crypto');
const hashPassword=password=>{
  const salt=crypto.randomBytes(16).toString('hex');
  return `scrypt$${salt}$${crypto.scryptSync(password,salt,32).toString('hex')}`;
};
function verifyPassword(password,stored,legacySecret){
  if(typeof password!=='string'||typeof stored!=='string')return false;
  let expected;
  if(stored.startsWith('scrypt$')){
    const parts=stored.split('$');if(parts.length!==3||!/^[a-f0-9]{32}$/.test(parts[1])||!/^[a-f0-9]{64}$/.test(parts[2]))return false;
    expected=`scrypt$${parts[1]}$${crypto.scryptSync(password,parts[1],32).toString('hex')}`;
  }else expected=crypto.createHmac('sha256',legacySecret).update(password).digest('hex');
  const a=Buffer.from(expected),b=Buffer.from(stored);return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
module.exports={hashPassword,verifyPassword};
