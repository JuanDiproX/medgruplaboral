const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const express=require('express');
const {crearXlsx,leerPlanilla}=require('../lib/planilla');
const {createImportador,sugerirMapeo}=require('../lib/importador');
test('planilla: lee xlsx y csv, salta títulos sueltos y rechaza formatos que no son planillas',()=>{
  const xlsx=crearXlsx('Casos',[['Listado <b>'],[],['Apellido y nombre','DNI'],['Pérez & Hnos, Juan','30111222']]);
  const [hoja]=leerPlanilla({nombre:'a.xlsx',base64:xlsx.toString('base64')});
  assert.deepEqual(hoja.encabezados,['Apellido y nombre','DNI']);assert.deepEqual(hoja.filas[0].celdas,['Pérez & Hnos, Juan','30111222']);assert.equal(hoja.filas[0].numero,4);
  const csv=leerPlanilla({nombre:'a.csv',base64:Buffer.from('Nombre;Documento\n"Gómez; Ana";28111222\n').toString('base64')})[0];
  assert.deepEqual(csv.filas[0].celdas,['Gómez; Ana','28111222']);
  assert.throws(()=>leerPlanilla({nombre:'a.xlsx',base64:Buffer.from('PK\x03\x04roto').toString('base64')}),/No pudimos abrir/);
  assert.throws(()=>leerPlanilla({nombre:'a.xls',base64:Buffer.from([0xd0,0xcf,0x11,0xe0]).toString('base64')}),/\.xls antiguo/);
  assert.deepEqual(sugerirMapeo(['Legajo','Apellido','Nombre','Nro. Documento','Celular','Dirección'],'casos'),{apellido:1,trabajador_nombre:2,trabajador_dni:3,trabajador_telefono:4,domicilio:5});
});
test('importación de casos: vista previa, repetidos, empresas desconocidas, permisos y deshacer',async()=>{
  const db=new PGlite();let http;
  try{
    await db.exec(`CREATE TABLE empresas_clientes(id SERIAL PRIMARY KEY,nombre TEXT,email TEXT,activo BOOLEAN DEFAULT true);
      CREATE TABLE casos_ausentismo(id SERIAL PRIMARY KEY,empresa_id INT,empresa_nombre TEXT,trabajador_nombre TEXT,trabajador_dni TEXT,trabajador_telefono TEXT,motivo TEXT,estado TEXT DEFAULT 'nuevo',
        profesional_id INT,turno_id TEXT,domicilio TEXT,tipo_control TEXT,solicitante_email TEXT,trabajador_email TEXT,notas_admin TEXT,caso_anterior_id INT);
      CREATE TABLE certificados_ausentismo(id SERIAL PRIMARY KEY,caso_id INT);CREATE TABLE informes_ausentismo(id SERIAL PRIMARY KEY,caso_id INT);
      CREATE TABLE pacientes_empresa(id SERIAL PRIMARY KEY,empresa TEXT,nombre TEXT,telefono TEXT,activo BOOLEAN DEFAULT true);
      INSERT INTO empresas_clientes(nombre,email) VALUES('Empresa Ficticia S.A.','rrhh@example.invalid');
      INSERT INTO casos_ausentismo(empresa_nombre,trabajador_nombre,trabajador_dni,estado) VALUES('Empresa Ficticia S.A.','Abierto, Caso','20000000','asignado');`);
    const query=(sql,p)=>!p&&sql.includes(';')?db.exec(sql).then(()=>({rows:[]})):db.query(sql,p);
    const pool={query,connect:async()=>({query,release(){}})};
    const app=express();app.use(express.json({limit:'10mb'}));
    const admin=(req,res,next)=>req.headers['x-rol']==='admin'?(req.usuario={nombre:'Admin de prueba',rol:'admin'},next()):res.status(403).json({error:'Solo administradores'});
    const importador=createImportador({app,pool,adminMiddleware:admin,fallo:(res,e)=>res.status(500).json({error:e.message})});await importador.init();
    http=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});const base='http://127.0.0.1:'+http.address().port;
    const archivo=crearXlsx('Casos',[['Apellido y nombre','DNI','Empresa','Domicilio','Motivo','Correo'],
      ['Uno, Persona','30.111.222','empresa ficticia s.a.','Calle 1','Gripe','uno@example.invalid'],
      ['Dos, <script>alert(1)</script>','31222333','Empresa Ficticia S.A.','','Esguince','correo-malo'],
      ['Abierto, Caso','20000000','Empresa Ficticia S.A.','Calle 3','',''],
      ['Tres, Persona','33444555','Otra Empresa','Calle 4','',''],
      ['Uno, Persona','30111222','Empresa Ficticia S.A.','Calle 1','Repetida','']]).toString('base64');
    const post=(ruta,body,rol='admin')=>fetch(base+ruta,{method:'POST',headers:{'content-type':'application/json','x-rol':rol},body:JSON.stringify(body)});
    assert.equal((await post('/api/admin/importaciones/analizar',{nombre:'c.xlsx',archivo_base64:archivo},'medico')).status,403);
    let r=await (await post('/api/admin/importaciones/analizar',{nombre:'c.xlsx',archivo_base64:archivo})).json();
    assert.deepEqual(r.resumen,{total:5,listas:1,con_aviso:1,repetidas:2,con_error:1});
    assert.deepEqual(r.empresas_faltantes,['Otra Empresa']);
    assert.equal(r.filas[0].datos.trabajador_dni,'30111222');assert.equal(r.filas[0].datos.empresa_nombre,'Empresa Ficticia S.A.','usa el nombre de empresa tal como está cargado');
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM casos_ausentismo')).rows[0].n,1,'analizar no guarda nada');
    r=await (await post('/api/admin/importaciones',{nombre:'c.xlsx',archivo_base64:archivo})).json();
    assert.equal(r.importadas,2);assert.equal(r.omitidas,3);
    const casos=(await db.query('SELECT * FROM casos_ausentismo WHERE importacion_id IS NOT NULL ORDER BY id')).rows;
    assert.equal(casos.length,2);assert.equal(casos[0].estado,'nuevo');assert.equal(casos[0].empresa_id,1);assert.equal(casos[1].trabajador_email,null,'un correo inválido no se guarda');
    assert.equal(casos[1].trabajador_nombre,'Dos, <script>alert(1)</script>','el texto se guarda tal cual: se escapa al mostrarlo');
    r=await (await post('/api/admin/importaciones',{nombre:'c.xlsx',archivo_base64:archivo})).json();
    assert.match(r.error,/No hay filas para importar/,'volver a subir el mismo archivo no duplica');
    await db.query("UPDATE casos_ausentismo SET estado='asignado',profesional_id=1 WHERE id=$1",[casos[0].id]);
    r=await (await fetch(base+'/api/admin/importaciones/'+r.id,{method:'DELETE',headers:{'x-rol':'admin'}})).json().catch(()=>({}));
    const lista=await (await fetch(base+'/api/admin/importaciones',{headers:{'x-rol':'admin'}})).json();
    r=await (await fetch(base+'/api/admin/importaciones/'+lista.importaciones[0].id,{method:'DELETE',headers:{'x-rol':'admin'}})).json();
    assert.equal(r.borradas,1);assert.equal(r.conservadas,1,'un caso ya asignado no se borra al deshacer');
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM casos_ausentismo')).rows[0].n,2);
  }finally{if(http)await new Promise(r=>http.close(r));await db.close();}
});
