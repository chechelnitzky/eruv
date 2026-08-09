import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { geoJSON } from 'leaflet'
import type { Session } from '@supabase/supabase-js'
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Polygon,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet'
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

type Ciclo = {
  id: string
  week_key: string
  opens_at: string
  status: 'open' | 'complete'
  completed_at: string | null
}

type Revision = {
  id: string
  cycle_id: string
  portico_id: string
  user_id: string
  status: 'ok' | 'problem'
  note: string | null
  checked_at: string
}

type Alerta = {
  id: string
  portico_id: string
  alert_type: string
  note: string | null
  status: 'open' | 'resolved'
  created_at: string
}

type EstadoPortico = 'unreviewed' | 'ok' | 'problem'
type ModoMapa = 'normal' | 'agregar' | 'mover'
type VistaMapa = 'satelite' | 'mapa'

const estilosEstado: Record<EstadoPortico, { color: string; fillColor: string; texto: string }> = {
  unreviewed: { color: '#737d78', fillColor: '#ffffff', texto: 'Sin revisar' },
  ok: { color: '#138a58', fillColor: '#32b777', texto: 'Revisado OK' },
  problem: { color: '#c83d32', fillColor: '#e55345', texto: 'Pórtico con problemas' },
}

const anilloExterior: [number, number][] = [
  [85, -180],
  [85, 180],
  [-85, 180],
  [-85, -180],
]

const featureLimite = (eruvData as any).features.find(
  (feature: any) => feature?.properties?.kind === 'boundary' && feature?.geometry?.type === 'Polygon',
)

const anilloEruv: [number, number][] = (featureLimite?.geometry?.coordinates?.[0] ?? []).map(
  ([lng, lat]: [number, number]) => [lat, lng],
)

function contextoRevisionChile() {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())

  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? ''
  const isoDia: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  const diaSemana = isoDia[valor('weekday')] ?? 1
  const anio = Number(valor('year'))
  const mes = Number(valor('month'))
  const dia = Number(valor('day'))
  const hora = Number(valor('hour'))
  const minuto = Number(valor('minute'))

  const fechaLocal = new Date(Date.UTC(anio, mes - 1, dia))
  const jueves = new Date(fechaLocal)
  jueves.setUTCDate(fechaLocal.getUTCDate() + (4 - diaSemana))
  const weekKey = `${jueves.getUTCFullYear()}-${String(jueves.getUTCMonth() + 1).padStart(2, '0')}-${String(jueves.getUTCDate()).padStart(2, '0')}`
  const reviewOpen = diaSemana > 4 || (diaSemana === 4 && (hora > 13 || (hora === 13 && minuto >= 0)))

  return { reviewOpen, weekKey }
}

function estiloTrazado(feature: any) {
  const tipo = feature?.properties?.kind
  if (tipo === 'boundary') return { color: '#1aa7d7', weight: 4, opacity: 0.98, fillOpacity: 0 }
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

function ClickMapa({
  modo,
  onClick,
}: {
  modo: ModoMapa
  onClick: (lat: number, lng: number) => void
}) {
  useMapEvents({
    click(e) {
      if (modo !== 'normal') onClick(e.latlng.lat, e.latlng.lng)
    },
  })
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

async function mostrarNotificacion(titulo: string, cuerpo: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try {
    if ('serviceWorker' in navigator) {
      const registro = await navigator.serviceWorker.ready
      await registro.showNotification(titulo, { body: cuerpo, tag: 'eruv-solicitud' })
      return
    }
    new Notification(titulo, { body: cuerpo })
  } catch {
    // El contador dentro de la app sigue funcionando aunque el navegador bloquee la notificación.
  }
}

export function App() {
  const [sesion, setSesion] = useState<Session | null>(null)
  const [authInicializada, setAuthInicializada] = useState(false)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [porticos, setPorticos] = useState<Portico[]>([])
  const [ciclos, setCiclos] = useState<Ciclo[]>([])
  const [revisiones, setRevisiones] = useState<Revision[]>([])
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [solicitudes, setSolicitudes] = useState<Perfil[]>([])
  const [mensajeAdmin, setMensajeAdmin] = useState('')
  const [mensajeMapa, setMensajeMapa] = useState('')
  const [modalAbierto, setModalAbierto] = useState(false)
  const [modoAuth, setModoAuth] = useState<'ingresar' | 'registro'>('ingresar')
  const [nombre, setNombre] = useState('')
  const [correo, setCorreo] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [mensajeAuth, setMensajeAuth] = useState('')
  const [cargandoAuth, setCargandoAuth] = useState(false)
  const [modoMapa, setModoMapa] = useState<ModoMapa>('normal')
  const [porticoAMover, setPorticoAMover] = useState<Portico | null>(null)
  const [vistaMapa, setVistaMapa] = useState<VistaMapa>('satelite')
  const [notificacionesActivas, setNotificacionesActivas] = useState(
    typeof Notification !== 'undefined' && Notification.permission === 'granted',
  )

  const paginaActivacion = window.location.pathname === '/cuenta-activada'
  const contextoRevision = useMemo(() => contextoRevisionChile(), [])

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

  const cargarPorticos = async () => {
    const { data } = await supabase
      .from('porticos')
      .select('id,code,name,latitude,longitude,description,active,sort_order')
      .eq('active', true)
      .order('sort_order')
    setPorticos((data as Portico[] | null) ?? [])
  }

  const cargarEstado = async () => {
    const [{ data: ciclosData }, { data: alertasData }] = await Promise.all([
      supabase
        .from('inspection_cycles')
        .select('id,week_key,opens_at,status,completed_at')
        .order('opens_at', { ascending: false })
        .limit(6),
      supabase
        .from('alerts')
        .select('id,portico_id,alert_type,note,status,created_at')
        .eq('status', 'open')
        .order('created_at', { ascending: false }),
    ])

    const nuevosCiclos = (ciclosData as Ciclo[] | null) ?? []
    setCiclos(nuevosCiclos)
    setAlertas((alertasData as Alerta[] | null) ?? [])

    const cicloVisual = contextoRevision.reviewOpen
      ? nuevosCiclos.find((c) => c.week_key === contextoRevision.weekKey)
      : nuevosCiclos[0]

    if (!cicloVisual) {
      setRevisiones([])
      return
    }

    const { data: checksData } = await supabase
      .from('checks')
      .select('id,cycle_id,portico_id,user_id,status,note,checked_at')
      .eq('cycle_id', cicloVisual.id)
      .order('checked_at', { ascending: false })
    setRevisiones((checksData as Revision[] | null) ?? [])
  }

  useEffect(() => {
    cargarPorticos()
    cargarEstado()
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

  useEffect(() => {
    const canal = supabase
      .channel('eruv-en-vivo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'porticos' }, () => cargarPorticos())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'checks' }, () => cargarEstado())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => cargarEstado())

    if (perfil?.is_admin) {
      canal.on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, async (payload: any) => {
        const nuevo = payload.new as Perfil | undefined
        const anterior = payload.old as Perfil | undefined
        await cargarSolicitudes()
        if (
          nuevo?.status === 'pending' &&
          nuevo?.email_confirmed_at &&
          (!anterior?.email_confirmed_at || anterior?.status !== 'pending')
        ) {
          await mostrarNotificacion('Nueva solicitud de revisor', `${nuevo.full_name || nuevo.email} quiere revisar el Eruv.`)
        }
      })
    }

    canal.subscribe()
    return () => {
      supabase.removeChannel(canal)
    }
  }, [perfil?.is_admin])

  const revisionesPorPortico = useMemo(() => {
    const mapa = new Map<string, Revision>()
    for (const revision of revisiones) {
      if (!mapa.has(revision.portico_id)) mapa.set(revision.portico_id, revision)
    }
    return mapa
  }, [revisiones])

  const alertasPorPortico = useMemo(() => {
    const mapa = new Map<string, Alerta>()
    for (const alerta of alertas) {
      if (!mapa.has(alerta.portico_id)) mapa.set(alerta.portico_id, alerta)
    }
    return mapa
  }, [alertas])

  const estadoPortico = (porticoId: string): EstadoPortico => {
    if (alertasPorPortico.has(porticoId)) return 'problem'
    const revision = revisionesPorPortico.get(porticoId)
    if (!revision) return 'unreviewed'
    return revision.status === 'ok' ? 'ok' : 'problem'
  }

  const conteoEstados = useMemo(() => {
    let ok = 0
    let problem = 0
    let unreviewed = 0
    for (const portico of porticos) {
      const estado = estadoPortico(portico.id)
      if (estado === 'ok') ok += 1
      else if (estado === 'problem') problem += 1
      else unreviewed += 1
    }
    return { ok, problem, unreviewed }
  }, [porticos, revisionesPorPortico, alertasPorPortico])

  const estadoGeneral = useMemo(() => {
    if (porticos.length === 0) return 'En preparación'
    if (conteoEstados.problem > 0) return 'Eruv pasul'
    if (conteoEstados.ok === porticos.length) return 'Eruv OK'
    if (contextoRevision.reviewOpen) return `${conteoEstados.ok}/${porticos.length} revisados`
    return 'Última revisión disponible'
  }, [porticos.length, conteoEstados, contextoRevision.reviewOpen])

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
          options: { data: { full_name: nombre.trim() }, emailRedirectTo: destinoConfirmacion },
        })
        if (error) throw error
        setMensajeAuth(
          correo.trim().toLowerCase() === 'chechelnitzky@gmail.com'
            ? 'Cuenta de administrador creada. Revisa tu correo para confirmar la dirección.'
            : 'Te enviamos un correo para validar tu dirección. Después de validarlo, tu solicitud quedará pendiente de aprobación del administrador.',
        )
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: correo.trim(), password: contrasena })
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
        ? `${usuario.full_name} fue aprobado como revisor.`
        : `${usuario.full_name} fue rechazado.`,
    )
  }

  const activarNotificaciones = async () => {
    if (!('Notification' in window)) {
      setMensajeAdmin('Este navegador no admite notificaciones del sistema.')
      return
    }
    const permiso = await Notification.requestPermission()
    setNotificacionesActivas(permiso === 'granted')
    setMensajeAdmin(
      permiso === 'granted'
        ? 'Notificaciones activadas. Te avisaremos mientras la app esté abierta o en segundo plano.'
        : 'No se otorgó permiso para notificaciones.',
    )
  }

  const siguienteNumeroPortico = () => {
    const numeros = porticos
      .map((p) => Number(p.code.replace(/\D/g, '')))
      .filter((n) => Number.isFinite(n))
    return numeros.length ? Math.max(...numeros) + 1 : 1
  }

  const manejarClickMapa = async (lat: number, lng: number) => {
    if (!perfil?.is_admin) return

    if (modoMapa === 'agregar') {
      const numero = siguienteNumeroPortico()
      const code = `P-${String(numero).padStart(2, '0')}`
      const { error } = await supabase.from('porticos').insert({
        code,
        name: `Pórtico ${numero}`,
        latitude: lat,
        longitude: lng,
        sort_order: numero,
        active: true,
      })
      if (error) {
        setMensajeMapa(error.message || 'No se pudo crear el pórtico.')
        return
      }
      setMensajeMapa(`${code} agregado. Puedes seguir tocando el mapa para agregar más.`)
      await cargarPorticos()
      return
    }

    if (modoMapa === 'mover' && porticoAMover) {
      const { error } = await supabase
        .from('porticos')
        .update({ latitude: lat, longitude: lng })
        .eq('id', porticoAMover.id)
      if (error) {
        setMensajeMapa(error.message || 'No se pudo mover el pórtico.')
        return
      }
      setMensajeMapa(`${porticoAMover.code} movido a su nueva posición.`)
      setModoMapa('normal')
      setPorticoAMover(null)
      await cargarPorticos()
    }
  }

  const editarNombrePortico = async (portico: Portico) => {
    if (!perfil?.is_admin) return
    const nuevoNombre = window.prompt('Nombre del pórtico', portico.name || portico.code)
    if (nuevoNombre === null) return
    const descripcion = window.prompt('Descripción o referencia opcional', portico.description || '')
    if (descripcion === null) return
    const { error } = await supabase
      .from('porticos')
      .update({ name: nuevoNombre.trim() || portico.code, description: descripcion.trim() || null })
      .eq('id', portico.id)
    if (!error) await cargarPorticos()
  }

  const eliminarPortico = async (portico: Portico) => {
    if (!perfil?.is_admin) return
    const confirmar = window.confirm(
      `¿Eliminar ${portico.name || portico.code}?\n\nEl punto dejará de aparecer en el mapa, pero conservaremos su historial de revisiones.`,
    )
    if (!confirmar) return

    const { error } = await supabase
      .from('porticos')
      .update({ active: false })
      .eq('id', portico.id)

    if (error) {
      setMensajeMapa(error.message || 'No se pudo eliminar el pórtico.')
      return
    }

    if (porticoAMover?.id === portico.id) {
      setPorticoAMover(null)
      setModoMapa('normal')
    }
    setMensajeMapa(`${portico.code} fue eliminado del mapa.`)
    await Promise.all([cargarPorticos(), cargarEstado()])
  }

  const marcarPortico = async (portico: Portico, estado: 'ok' | 'problem') => {
    if (!sesion || !(perfil?.is_admin || perfil?.status === 'approved')) return
    let nota = ''
    if (estado === 'problem') {
      const respuesta = window.prompt('Describe brevemente el problema del pórtico:', '')
      if (respuesta === null) return
      nota = respuesta
    } else {
      const respuesta = window.prompt('Nota opcional de la revisión:', '')
      if (respuesta === null) return
      nota = respuesta
    }

    const { error } = await supabase.rpc('review_portico', {
      p_portico_id: portico.id,
      p_status: estado,
      p_note: nota,
    })
    if (error) {
      setMensajeMapa(error.message)
      return
    }
    setMensajeMapa(estado === 'ok' ? `${portico.code} marcado como Revisado OK.` : `${portico.code} marcado con problemas.`)
    await cargarEstado()
  }

  const restablecerPortico = async (portico: Portico) => {
    if (!perfil?.is_admin) return
    const { error } = await supabase.rpc('reset_portico_review', { p_portico_id: portico.id })
    if (error) {
      setMensajeMapa(error.message)
      return
    }
    setMensajeMapa(`${portico.code} quedó Sin revisar.`)
    await cargarEstado()
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
        detalle = 'Tu cuenta todavía está pendiente de aprobación para actuar como revisor del Eruv. El administrador debe aprobar tu solicitud antes de que puedas revisar o reportar cambios.'
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
          <button className="login-button" onClick={() => { window.location.href = '/' }}>Ir al mapa del Eruv</button>
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
            {perfil?.is_admin && solicitudes.length > 0 && <span className="badge-notificacion">🔔 {solicitudes.length}</span>}
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
          <p>Cualquier persona puede consultar el mapa y el estado. Para revisar un pórtico o reportar un problema hay que iniciar sesión con una cuenta aprobada.</p>
          {perfil?.status === 'pending' && perfil.email_confirmed_at && (
            <div className="aviso-pendiente">Tu correo está validado. Tu acceso como revisor todavía debe ser aprobado por el administrador.</div>
          )}
        </div>
        <div className={`estado-semanal ${conteoEstados.problem > 0 ? 'estado-pasul' : conteoEstados.ok === porticos.length && porticos.length > 0 ? 'estado-ok' : ''}`}>
          <small>Estado semanal</small>
          <strong>{estadoGeneral}</strong>
          {porticos.length > 0 && <span>{conteoEstados.ok} OK · {conteoEstados.unreviewed} sin revisar · {conteoEstados.problem} con problema</span>}
        </div>
      </section>

      <section className="leyenda">
        <span><i className="punto punto-verde" /> Revisado OK</span>
        <span><i className="punto punto-gris" /> Sin revisar</span>
        <span><i className="punto punto-rojo" /> Pórtico con problemas</span>
      </section>

      {perfil?.is_admin && (
        <section className="barra-admin-mapa">
          <strong>Edición del mapa</strong>
          <div className="acciones-admin-mapa">
            <button
              className={modoMapa === 'agregar' ? 'boton-admin activo' : 'boton-admin'}
              onClick={() => {
                setModoMapa(modoMapa === 'agregar' ? 'normal' : 'agregar')
                setPorticoAMover(null)
                setMensajeMapa(modoMapa === 'agregar' ? '' : 'Modo agregar activo: haz zoom y toca el punto exacto de cada pórtico.')
              }}
            >
              {modoMapa === 'agregar' ? '✓ Terminar de agregar' : '+ Agregar pórticos'}
            </button>
            <button className="boton-admin" onClick={activarNotificaciones}>
              {notificacionesActivas ? '🔔 Notificaciones activas' : '🔔 Activar notificaciones'}
            </button>
          </div>
          {modoMapa === 'mover' && porticoAMover && <span className="instruccion-mapa">Toca en el mapa la nueva posición de {porticoAMover.code}.</span>}
          {mensajeMapa && <span className="instruccion-mapa">{mensajeMapa}</span>}
        </section>
      )}

      <main className={`map-wrap ${modoMapa !== 'normal' ? 'mapa-editando' : ''}`}>
        <div
          style={{
            position: 'absolute',
            zIndex: 1000,
            top: 12,
            right: 12,
            display: 'flex',
            gap: 4,
            padding: 4,
            borderRadius: 999,
            background: 'rgba(255,255,255,.94)',
            boxShadow: '0 4px 18px rgba(0,0,0,.18)',
          }}
        >
          <button
            type="button"
            onClick={() => setVistaMapa('satelite')}
            style={{
              border: 0,
              borderRadius: 999,
              padding: '7px 10px',
              background: vistaMapa === 'satelite' ? '#0f3d2e' : 'transparent',
              color: vistaMapa === 'satelite' ? '#fff' : '#355247',
              fontWeight: 800,
              fontSize: 12,
            }}
          >
            Satélite
          </button>
          <button
            type="button"
            onClick={() => setVistaMapa('mapa')}
            style={{
              border: 0,
              borderRadius: 999,
              padding: '7px 10px',
              background: vistaMapa === 'mapa' ? '#0f3d2e' : 'transparent',
              color: vistaMapa === 'mapa' ? '#fff' : '#355247',
              fontWeight: 800,
              fontSize: 12,
            }}
          >
            Mapa
          </button>
        </div>

        <MapContainer center={[-33.3567, -70.5193]} zoom={14} scrollWheelZoom className="map" maxZoom={20}>
          <AjustarMapaAlEruv />
          <ClickMapa modo={modoMapa} onClick={manejarClickMapa} />

          {vistaMapa === 'satelite' ? (
            <TileLayer
              attribution='Tiles &copy; Esri'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={20}
            />
          ) : (
            <TileLayer
              attribution='&copy; OpenStreetMap contributors &copy; CARTO'
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
              maxZoom={20}
            />
          )}

          {anilloEruv.length > 2 && (
            <Polygon
              positions={[anilloExterior, anilloEruv]}
              interactive={false}
              pathOptions={{ color: '#d74435', weight: 0, fillColor: '#d74435', fillOpacity: 0.2 }}
            />
          )}

          <GeoJSON data={eruvData as any} style={estiloTrazado} onEachFeature={(feature, layer) => layer.bindTooltip(nombreTramo(feature))} />

          {porticos.map((portico) => {
            const estado = estadoPortico(portico.id)
            const estilo = estilosEstado[estado]
            const alerta = alertasPorPortico.get(portico.id)
            const revision = revisionesPorPortico.get(portico.id)
            const puedeRevisar = perfil?.is_admin || perfil?.status === 'approved'

            return (
              <CircleMarker
                key={portico.id}
                center={[portico.latitude, portico.longitude]}
                radius={9}
                pathOptions={{ color: estilo.color, fillColor: estilo.fillColor, fillOpacity: 1, weight: 3 }}
              >
                <Tooltip direction="top" offset={[0, -8]}>{portico.code}</Tooltip>
                <Popup minWidth={230}>
                  <div className="popup-portico">
                    <strong>{portico.name || portico.code}</strong>
                    <span className={`estado-portico estado-${estado}`}>{estilo.texto}</span>
                    {portico.description && <small>{portico.description}</small>}
                    {alerta?.note && <p><b>Problema:</b> {alerta.note}</p>}
                    {revision && <small>Última revisión: {new Date(revision.checked_at).toLocaleString('es-CL')}</small>}

                    {puedeRevisar ? (
                      <div className="acciones-portico">
                        <button
                          className="accion-ok"
                          disabled={!contextoRevision.reviewOpen}
                          onClick={() => marcarPortico(portico, 'ok')}
                        >
                          ✓ Revisado OK
                        </button>
                        <button className="accion-problema" onClick={() => marcarPortico(portico, 'problem')}>⚠ Reportar problema</button>
                        {perfil?.is_admin && (
                          <>
                            <button
                              className="accion-neutra"
                              onClick={() => {
                                setPorticoAMover(portico)
                                setModoMapa('mover')
                                setMensajeMapa(`Toca en el mapa la nueva posición de ${portico.code}.`)
                              }}
                            >
                              Mover
                            </button>
                            <button className="accion-neutra" onClick={() => editarNombrePortico(portico)}>Editar datos</button>
                            <button className="accion-neutra" onClick={() => restablecerPortico(portico)}>Sin revisar</button>
                            <button className="accion-problema" onClick={() => eliminarPortico(portico)}>Eliminar pórtico</button>
                          </>
                        )}
                      </div>
                    ) : (
                      <small>Inicia sesión con una cuenta de revisor aprobada para modificar el estado.</small>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            )
          })}
        </MapContainer>
        <div className="map-note">Zona roja: fuera del Eruv · Trazado georreferenciado desde el mapa original.</div>
      </main>

      {perfil?.is_admin && (
        <section className="panel-admin panel-admin-bajo-mapa">
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
                <label>Nombre completo<input value={nombre} onChange={(e) => setNombre(e.target.value)} required /></label>
              )}
              <label>Correo electrónico<input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} required /></label>
              <label>Contraseña<input type="password" value={contrasena} onChange={(e) => setContrasena(e.target.value)} minLength={6} required /></label>
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
