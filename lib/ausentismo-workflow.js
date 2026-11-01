const {validCoordinates} = require('./control-evidence');
const error = (status,message) => Object.assign(new Error(message),{status});
function validate(data) {
  if (!String(data.empresa_nombre || '').trim()) throw error(400,'Elegí una empresa');
  if (!String(data.trabajador_nombre || '').trim()) throw error(400,'Escribí el nombre del trabajador');
  if (data.radio_metros != null && (!Number.isInteger(data.radio_metros) || data.radio_metros < 50 || data.radio_metros > 5000)) throw error(400,'El radio debe estar entre 50 y 5000 metros');
  const hasLat = data.domicilio_lat != null, hasLng = data.domicilio_lng != null;
  if (hasLat !== hasLng || hasLat && !validCoordinates(data.domicilio_lat,data.domicilio_lng,0)) throw error(400,'Revisá las coordenadas del domicilio');
}
function registerWorkflow({app,pool,adminMiddleware,geocodificar,vincular,TIPOS_CONTROL}) {
  const wrap = fn => async(req,res) => {try{await fn(req,res);}catch(e){res.status(e.status||500).json({error:e.status?e.message:'No se pudo guardar el control. Intentá nuevamente.'});}};
  async function location(data) {
    validate(data);
    if (data.domicilio_lat != null) return {lat:data.domicilio_lat,lng:data.domicilio_lng};
    if (data.domicilio) {
      const g=await geocodificar(data.domicilio);
      if(g.punto) return g.punto;
      if(data.validar_domicilio) throw error(422,g.motivo || 'No pudimos ubicar la dirección. Corregila o guardá un borrador.');
      return {lat:null,lng:null,motivo:g.motivo};
    }
    if(data.validar_domicilio) throw error(400,'Cargá y verificá el domicilio antes de guardar');
    return {lat:null,lng:null};
  }
  async function save(req,res,previousId) {
    const db=await pool.connect();
    let id, data, geo, existed=false;
    try {
      await db.query('BEGIN');
      let previous=null;
      if(previousId) {
        previous=(await db.query('SELECT * FROM casos_ausentismo WHERE id=$1 FOR UPDATE',[previousId])).rows[0];
        if(!previous) throw error(404,'Caso no encontrado');
        if(!['resuelto','cancelado'].includes(previous.estado)) throw error(409,'El control sigue abierto. Continuá ese control antes de crear otro.');
      }
      // Reuse identity/contact/assigned clinician only. Clinical documents, signatures,
      // exceptions, entry tokens and attendance records are never inherited.
      data={...(previous || {}),...req.body};
      if(previous && (data.empresa_nombre !== previous.empresa_nombre ||
        (previous.trabajador_dni && String(data.trabajador_dni||'').replace(/\D/g,'') !== String(previous.trabajador_dni).replace(/\D/g,'')))) {
        throw error(400,'Un control posterior debe corresponder a la misma empresa y trabajador. Para otra persona, cargá un caso nuevo.');
      }
      if(previous && req.body.domicilio !== undefined && req.body.domicilio !== previous.domicilio) {
        data.domicilio_lat=req.body.domicilio_lat ?? null; data.domicilio_lng=req.body.domicilio_lng ?? null;
      }
      validate(data);
      if(data.tipo_control && !TIPOS_CONTROL[data.tipo_control]) throw error(400,'Tipo de control desconocido');
      const identity=String(data.trabajador_dni||'').replace(/\D/g,'') || data.trabajador_nombre.trim().toLowerCase();
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[data.empresa_nombre+'|'+identity]);
      if(previous) {
        const open=(await db.query(`SELECT id FROM casos_ausentismo WHERE caso_anterior_id=$1 AND estado NOT IN ('resuelto','cancelado') LIMIT 1`,[previous.id])).rows[0];
        if(open){id=open.id;existed=true;}
      }
      if(!existed) {
        geo=await location(data);
        const company=(await db.query('SELECT id FROM empresas_clientes WHERE nombre=$1 LIMIT 1',[data.empresa_nombre])).rows[0];
        if(!company) throw error(400,'La empresa seleccionada ya no existe');
        const prof=data.profesional_id ? (await db.query('SELECT id FROM medicos WHERE id=$1 AND activo=true',[data.profesional_id])).rows[0] : null;
        if(req.body.profesional_id && !prof) throw error(400,'Elegí un profesional activo');
        const result=await db.query(`INSERT INTO casos_ausentismo
          (empresa_id,empresa_nombre,trabajador_nombre,trabajador_dni,trabajador_telefono,motivo,documentacion,notas_admin,
          domicilio,domicilio_lat,domicilio_lng,radio_metros,tipo_control,profesional_id,estado,caso_anterior_id,excepcion_geo)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,false) RETURNING id`,
          [company.id,data.empresa_nombre,data.trabajador_nombre.trim(),data.trabajador_dni||'',data.trabajador_telefono||'',
          req.body.motivo ?? '',req.body.documentacion ?? '',req.body.notas_admin ?? '',data.domicilio||'',geo.lat,geo.lng,data.radio_metros||300,
          data.tipo_control||'ausentismo',prof?.id||null,prof?'asignado':'nuevo',previous?.id||null]);
        id=result.rows[0].id;
      }
      await db.query('COMMIT');
    }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
    if(!existed) await vincular({casoId:id,nombre:data.trabajador_nombre,dni:data.trabajador_dni});
    res.json({ok:true,id,ya_existia:existed,domicilio_ubicado:geo?.lat!=null,motivo_geocode:geo?.motivo,profesional_asignado:!!data.profesional_id});
  }
  app.post('/api/ausentismo/casos',adminMiddleware,wrap((req,res)=>save(req,res,null)));
  app.post('/api/ausentismo/casos/:id/nuevo-control',adminMiddleware,wrap((req,res)=>save(req,res,req.params.id)));
}
module.exports={registerWorkflow,validate};
