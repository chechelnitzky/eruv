import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { geoJSON } from 'leaflet'
import type { Session } from '@supabase/supabase-js'
import { CircleMarker, GeoJSON, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet'
import eruvData from './data/eruv.geojson'
import { supabase } from './lib/supabase'

type Perfil = {
  id: string
  full_name: string
  email: string | null
  email_confirmed_at: string | null
  status: 'pending' | 'approved' | 'rejected'
  is_admin: boolean
  created_at?: string
}

type Portico = {
  id: string
  code: string
  name: string | null
  latitude: number
  longitude: number
  description: string | null
  active: boolean
  sort_order: number
}

function estiloTrazado(feature: any) {
  const tipo = feature?.properties?.kind

  if (tipo === 'boundary') {
    return {
      color: '#1aa7d7',
      weight: 4,
      opacity: 0.98,
      fillOpacity: 0,
    }
  }

  if (tipo === 'critical') return { color: '#df4935', weight: 8, opacity: 1 }
  if (tipo === 'warning') return { color: '#ed8124', weight: 7, opacity: 1 }
  return { color: '#55645d', weight: 3, opacity: 0.75, dashArray: '7 7' }
}

function nombreTramo(feature: any) {
  const tipo = feature?.properties?.kind
  if (tipo === 'boundary') return 'Límite del Eruv'
  if (tipo === 'critical') return 'Tramo crítico del Eruv'
  if (tipo === 'warning') return 'Tramo a revisar'
  return 'Tramo del Eruv'
}

function AjustarMapaAlEruv() {
  const mapa = useMap()

  useEffect(() => {
    const limites = geoJSON(eruvData as any).getBounds()
    if (limites.isValid()) mapa.fitBounds(limites, { padding: [28, 28], maxZoom: 16 })
  }, [mapa])

  return null
}

function textoEstadoCuenta(perfil: Perfil | null) {
  if (!perfil) return 'Invitado'
  if (perfil.is_admin) return 'Administrador'
  if (perfil.status === 'approved') return 'Revisor aprobado'
  if (perfil.status === 'rejected') return 'Acceso rechazado'
  if (perfil.email_confirmed_at) return 'Pendiente de aprobación'
  return 'Correo pendiente de validación'
}

export function App() {
  const [sesion, setSesion] = useState<Session | null>(null)
  const [authInicializada, setAuthInicializada] = useState(false)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [porticos, setPorticos] = useState<Portico[]>([])
  const [solicitudes, setSolicitudes] = useState<Perfil[]>([])
  const [mensajeAdmin, setMensajeAdmin] = useState('')
  const [modalAbierto, setModalAbierto] = useState(false)
  const [modoAuth, setModoAuth] = useState<'ingresar' | 'registro'>('ingresar')
  const [nombre, setNombre] = useState('')
  const [correo, setCorreo] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [mensajeAuth, setMensajeAuth] = useState('')
  const [cargandoAuth, setCargandoAuth] = useState(false)

  const paginaActivacion = window.location.pathname === '/cuenta-activada'

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSesion(data.session)
      setAuthInicializada(true)
    })

    const { data } = supabase.auth.onAuthStateChange((_evento, nuevaSesion) => {
      setSesion(nuevaSesion)
      setAuthInicializada(true)
    })

    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const cargarPorticos = async () => {
      const { data } = await supabase
        .from('porticos')
        .select('id,code,name,latitude,longitude,description,active,sort_order')
        .eq('active', true)
        .order('sort_order')
      setPorticos((data as Portico[] | null) ?? [])
    }
    cargarPorticos()
  }, [])

  useEffect(() => {
    if (!sesion?.user?.id) {
      setPerfil(null)
      return
    }

    const cargarPerfil = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id,full_name,email,email_confirmed_at,status,is_admin,created_at')
        .eq('id', sesion.user.id)
        .maybeSingle()
      setPerfil((data as Perfil | null) ?? null)
    }

    cargarPerfil()
  }, [sesion])

  const cargarSolicitudes = async () => {
    if (!perfil?.is_admin) return

    const { data, error } = await supabase
      .from('profiles')
      .select('id,full_name,email,email_confirmed_at,status,is_admin,created_at')
      .eq('status', 'pending')
      .not('email_confirmed_at', 'is', null)
      .order('created_at', { ascending: true })

    if (error) {
      setMensajeAdmin('No se pudieron cargar las solicitudes.')
      return
    }

    setSolicitudes((data as Perfil[] | null) ?? [])
  }

  useEffect(() => {
    if (perfil?.is_admin) cargarSolicitudes()
    else setSolicitudes([])
  }, [perfil?.is_admin])

  const estadoGeneral = useMemo(() => {
    if (porticos.length === 0) return 'En preparación'
    return 'En revisión'
  }, [porticos.length])

  const enviarAuth = async (evento: FormEvent) => {
    evento.preventDefault()
    setMensajeAuth('')
    setCargandoAuth(true)

    try {
      if (modoAuth === 'registro') {
        const destinoConfirmacion = `${window.location.origin}/cuenta-activada`
        const { error } = await supabase.auth.signUp({
          email: correo.trim(),
          password: contrasena,
          options: {
            data: { full_name: nombre.trim() },
            emailRedirectTo: destinoConfirmacion,
          },
        })
        if (error) throw error

        setMensajeAuth(
          correo.trim().toLowerCase() === 'chechelnitzky@gmail.com'
            ? 'Cuenta de administrador creada. Revisa tu correo para confirmar la dirección.'
            : 'Te enviamos un correo para validar tu dirección. Después de validarlo, tu solicitud será enviada al administrador. Todavía no podrás revisar pórticos hasta que sea aprobada.',
        )
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: correo.trim(),
          password: contrasena,
        })
        if (error) throw error
        setModalAbierto(false)
      }
    } catch (error: any) {
      setMensajeAuth(error?.message ?? 'No se pudo completar la operación.')
    } finally {
      setCargandoAuth(false)
    }
  }

  const cerrarSesion = async () => {
    await supabase.auth.signOut()
    setPerfil(null)
  }

  const resolverSolicitud = async (usuario: Perfil, nuevoEstado: 'approved' | 'rejected') => {
    if (!sesion?.user?.id || !perfil?.is_admin) return
    setMensajeAdmin('')

    const cambios: Record<string, any> = { status: nuevoEstado }
    if (nuevoEstado === 'approved') {
      cambios.approved_at = new Date().toISOString()
      cambios.approved_by = sesion.user.id
    }

    const { error } = await supabase.from('profiles').update(cambios).eq('id', usuario.id)

    if (error) {
      setMensajeAdmin(error.message || 'No se pudo actualizar la solicitud.')
      return
    }

    setSolicitudes((actuales) => actuales.filter((item) => item.id !== usuario.id))
    setMensajeAdmin(
      nuevoEstado === 'approved'
        ? `${usuario.full_name} fue aprobado como revisor. Se enviará un correo de confirmación.`
        : `${usuario.full_name} fue rechazado.`,
    )
  }

  if (paginaActivacion) {
    let titulo = 'Validando tu cuenta…'
    let detalle = 'Estamos comprobando la confirmación de tu correo.'

    if (authInicializada) {
      if (perfil?.is_admin) {
        titulo = 'Tu cuenta de administrador está activa'
        detalle = 'Tu correo fue validado correctamente y ya tienes acceso de administrador.'
      } else if (perfil?.status === 'approved') {
        titulo = 'Tu cuenta ya está aprobada'
        detalle = 'Ya puedes ingresar como revisor del Eruv, revisar pórticos y reportar problemas.'
      } else if (perfil?.status === 'rejected') {
        titulo = 'Tu correo fue validado'
        detalle = 'Tu solicitud de acceso como revisor no fue aprobada por el administrador.'
      } else if (perfil?.email_confirmed_at || sesion) {
        titulo = 'Tu correo ya fue validado'
        detalle = 'Tu cuenta todavía está pendiente de aprobación para actuar como revisor del Eruv. El administrador recibió tu solicitud. Te enviaremos un correo cuando sea aprobada.'
      } else {
        titulo = 'Tu correo fue validado'
        detalle = 'La validación fue recibida. Vuelve al mapa e ingresa con tu cuenta para ver el estado de tu solicitud.'
      }
    }

    return (
      <div className="pantalla-activacion">
        <div className="tarjeta-activacion">
          <div className="check-activacion">✓</div>
          <p className="eyebrow">Eruv La Dehesa</p>
          <h1>{titulo}</h1>
          <p>{detalle}</p>
          <button className="login-button" onClick={() => { window.location.href = '/' }}>
            Ir al mapa del Eruv
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Eruv La Dehesa</p>
          <h1>Estado del Eruv</h1>
        </div>

        {sesion ? (
          <div className="cuenta-activa">
            <div>
              <strong>{perfil?.full_name || sesion.user.email}</strong>
              <span>{textoEstadoCuenta(perfil)}</span>
            </div>
            <button className="boton-secundario" onClick={cerrarSesion}>Cerrar sesión</button>
          </div>
        ) : (
          <button className="login-button" onClick={() => setModalAbierto(true)}>Ingresar</button>
        )}
      </header>

      <section className="status-card">
        <div>
          <span className="status-pill">
            {perfil?.is_admin ? 'Administrador' : perfil?.status === 'approved' ? 'Revisor aprobado' : sesion ? 'Usuario registrado' : 'Vista pública · Invitado'}
          </span>
          <h2>Mapa del Eruv de La Dehesa</h2>
          <p>
            Cualquier persona puede consultar el mapa y el estado. Para revisar un pórtico o reportar un problema hay que iniciar sesión con una cuenta aprobada.
          </p>
          {perfil?.status === 'pending' && perfil.email_confirmed_at && (
            <div className="aviso-pendiente">Tu correo está validado. Tu acceso como revisor todavía debe ser aprobado por el administrador.</div>
          )}
        </div>
        <div className="estado-semanal">
          <small>Estado semanal</small>
          <strong>{estadoGeneral}</strong>
        </div>
      </section>

      {perfil?.is_admin && (
        <section className="panel-admin">
          <div className="panel-admin-cabecera">
            <div>
              <p className="eyebrow">Administración</p>
              <h2>Solicitudes de revisores</h2>
            </div>
            <span className="contador-solicitudes">{solicitudes.length} pendiente{solicitudes.length === 1 ? '' : 's'}</span>
          </div>

          {solicitudes.length === 0 ? (
            <p className="sin-solicitudes">No hay solicitudes pendientes con correo validado.</p>
          ) : (
            <div className="lista-solicitudes">
              {solicitudes.map((usuario) => (
                <div className="solicitud" key={usuario.id}>
                  <div>
                    <strong>{usuario.full_name}</strong>
                    <span>{usuario.email}</span>
                  </div>
                  <div className="acciones-solicitud">
                    <button className="boton-rechazar" onClick={() => resolverSolicitud(usuario, 'rejected')}>Rechazar</button>
                    <button className="boton-aprobar" onClick={() => resolverSolicitud(usuario, 'approved')}>Aprobar revisor</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {mensajeAdmin && <div className="mensaje-admin">{mensajeAdmin}</div>}
        </section>
      )}

      <section className="leyenda">
        <span><i className="punto punto-verde" /> Eruv OK</span>
        <span><i className="punto punto-gris" /> Sin revisar</span>
        <span><i className="punto punto-naranjo" /> Pórtico con problemas</span>
        <span><i className="punto punto-rojo" /> Eruv pasul</span>
      </section>

      <main className="map-wrap">
        <MapContainer center={[-33.3567, -70.5193]} zoom={14} scrollWheelZoom className="map" maxZoom={20}>
          <AjustarMapaAlEruv />
          <TileLayer
            attribution='&copy; OpenStreetMap contributors &copy; CARTO'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            maxZoom={20}
          />
          <GeoJSON
            data={eruvData as any}
            style={estiloTrazado}
            onEachFeature={(feature, layer) => layer.bindTooltip(nombreTramo(feature))}
          />

          {porticos.map((portico) => (
            <CircleMarker
              key={portico.id}
              center={[portico.latitude, portico.longitude]}
              radius={8}
              pathOptions={{ color: '#69736e', fillColor: '#ffffff', fillOpacity: 1, weight: 3 }}
            >
              <Popup>
                <strong>{portico.name || portico.code}</strong><br />
                Estado: sin revisar
                {portico.description ? <><br />{portico.description}</> : null}
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>

        <div className="map-note">Trazado georreferenciado desde el mapa original · La Dehesa, Lo Barnechea.</div>
      </main>

      {modalAbierto && (
        <div className="modal-fondo" onMouseDown={() => setModalAbierto(false)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <button className="modal-cerrar" onClick={() => setModalAbierto(false)} aria-label="Cerrar">×</button>
            <div className="tabs-auth">
              <button className={modoAuth === 'ingresar' ? 'activo' : ''} onClick={() => { setModoAuth('ingresar'); setMensajeAuth('') }}>Ingresar</button>
              <button className={modoAuth === 'registro' ? 'activo' : ''} onClick={() => { setModoAuth('registro'); setMensajeAuth('') }}>Crear cuenta</button>
            </div>

            <h2>{modoAuth === 'ingresar' ? 'Ingresar al Eruv' : 'Solicitar acceso'}</h2>
            <p className="modal-intro">
              {modoAuth === 'ingresar'
                ? 'Los revisores aprobados pueden revisar pórticos y reportar problemas.'
                : 'Primero validarás tu correo. Después el administrador deberá aprobar tu acceso como revisor.'}
            </p>

            <form onSubmit={enviarAuth} className="form-auth">
              {modoAuth === 'registro' && (
                <label>
                  Nombre completo
                  <input value={nombre} onChange={(e) => setNombre(e.target.value)} required />
                </label>
              )}
              <label>
                Correo electrónico
                <input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} required />
              </label>
              <label>
                Contraseña
                <input type="password" value={contrasena} onChange={(e) => setContrasena(e.target.value)} minLength={6} required />
              </label>
              <button className="login-button boton-ancho" disabled={cargandoAuth}>
                {cargandoAuth ? 'Procesando…' : modoAuth === 'ingresar' ? 'Ingresar' : 'Crear cuenta'}
              </button>
            </form>

            {mensajeAuth && <div className="mensaje-auth">{mensajeAuth}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
