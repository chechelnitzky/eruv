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
  status: 'pending' | 'approved' | 'rejected'
  is_admin: boolean
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

  if (tipo === 'critical') {
    return { color: '#df4935', weight: 8, opacity: 1 }
  }

  if (tipo === 'warning') {
    return { color: '#ed8124', weight: 7, opacity: 1 }
  }

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
    if (limites.isValid()) {
      mapa.fitBounds(limites, { padding: [28, 28], maxZoom: 16 })
    }
  }, [mapa])

  return null
}

function textoEstadoCuenta(perfil: Perfil | null) {
  if (!perfil) return 'Invitado'
  if (perfil.is_admin) return 'Administrador'
  if (perfil.status === 'approved') return 'Usuario aprobado'
  if (perfil.status === 'rejected') return 'Acceso rechazado'
  return 'Pendiente de aprobación'
}

function PantallaCuentaActivada({ esAdmin }: { esAdmin: boolean }) {
  return (
    <div className="activacion-pagina">
      <div className="activacion-tarjeta">
        <div className="activacion-icono">✓</div>
        <p className="eyebrow">Eruv La Dehesa</p>
        <h1>Tu cuenta ya fue activada</h1>
        <p>
          Tu correo electrónico fue validado correctamente.
          {esAdmin
            ? ' Tu cuenta tiene permisos de administrador y ya puedes ingresar.'
            : ' Ya puedes volver a la aplicación. Si tu cuenta aún está pendiente, el administrador deberá aprobarla antes de que puedas revisar pórticos o reportar problemas.'}
        </p>
        <button className="login-button boton-ancho" onClick={() => { window.location.href = '/' }}>
          Ir al mapa del Eruv
        </button>
      </div>
    </div>
  )
}

export function App() {
  const [sesion, setSesion] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [porticos, setPorticos] = useState<Portico[]>([])
  const [modalAbierto, setModalAbierto] = useState(false)
  const [modoAuth, setModoAuth] = useState<'ingresar' | 'registro'>('ingresar')
  const [nombre, setNombre] = useState('')
  const [correo, setCorreo] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [mensajeAuth, setMensajeAuth] = useState('')
  const [cargandoAuth, setCargandoAuth] = useState(false)
  const esPantallaActivacion = window.location.pathname === '/cuenta-activada'

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSesion(data.session))
    const { data } = supabase.auth.onAuthStateChange((_evento, nuevaSesion) => {
      setSesion(nuevaSesion)
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
        .select('id,full_name,status,is_admin')
        .eq('id', sesion.user.id)
        .maybeSingle()
      setPerfil((data as Perfil | null) ?? null)
    }
    cargarPerfil()
  }, [sesion])

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
        const { error } = await supabase.auth.signUp({
          email: correo.trim(),
          password: contrasena,
          options: {
            data: { full_name: nombre.trim() },
            emailRedirectTo: `${window.location.origin}/cuenta-activada`,
          },
        })
        if (error) throw error
        setMensajeAuth(
          correo.trim().toLowerCase() === 'chechelnitzky@gmail.com'
            ? 'Cuenta de administrador creada. Revisa tu correo y confirma la dirección para activarla.'
            : 'Cuenta creada. Revisa tu correo para validar la dirección. Después quedará pendiente de aprobación del administrador.',
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

  if (esPantallaActivacion) {
    return <PantallaCuentaActivada esAdmin={Boolean(perfil?.is_admin)} />
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
          <span className="status-pill">Vista pública · Invitado</span>
          <h2>Mapa del Eruv de La Dehesa</h2>
          <p>
            Cualquier persona puede consultar el mapa y el estado. Para revisar un pórtico o reportar un problema hay que iniciar sesión con una cuenta aprobada.
          </p>
        </div>
        <div className="estado-semanal">
          <small>Estado semanal</small>
          <strong>{estadoGeneral}</strong>
        </div>
      </section>

      <section className="leyenda">
        <span><i className="punto punto-verde" /> Eruv OK</span>
        <span><i className="punto punto-gris" /> Sin revisar</span>
        <span><i className="punto punto-naranjo" /> Pórtico con problemas</span>
        <span><i className="punto punto-rojo" /> Eruv pasul</span>
      </section>

      <main className="map-wrap">
        <MapContainer
          center={[-33.3567, -70.5193]}
          zoom={14}
          scrollWheelZoom
          className="map"
          maxZoom={20}
        >
          <AjustarMapaAlEruv />
          <TileLayer
            attribution='&copy; OpenStreetMap contributors &copy; CARTO'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            maxZoom={20}
          />
          <GeoJSON
            data={eruvData as any}
            style={estiloTrazado}
            onEachFeature={(feature, layer) => {
              layer.bindTooltip(nombreTramo(feature))
            }}
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

        <div className="map-note">
          Trazado georreferenciado desde el mapa original · La Dehesa, Lo Barnechea.
        </div>
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
                ? 'Los usuarios aprobados pueden revisar pórticos y reportar problemas.'
                : 'Las cuentas nuevas deben ser aprobadas por el administrador antes de poder hacer cambios.'}
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
