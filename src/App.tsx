import { GeoJSON, MapContainer, TileLayer } from 'react-leaflet'
import eruvData from './data/eruv.geojson'

const ERUV_BOUNDS: [[number, number], [number, number]] = [
  [-33.3692, -70.5292],
  [-33.3452, -70.5092],
]

function featureStyle(feature: any) {
  const kind = feature?.properties?.kind

  if (kind === 'boundary') {
    return {
      color: '#23a8d7',
      weight: 4,
      opacity: 0.95,
      fillColor: '#23a8d7',
      fillOpacity: 0.045,
    }
  }

  if (kind === 'critical') {
    return { color: '#e44b34', weight: 7, opacity: 1 }
  }

  if (kind === 'warning') {
    return { color: '#f08a24', weight: 6, opacity: 1 }
  }

  return { color: '#5d6c65', weight: 3, opacity: 0.8, dashArray: '6 6' }
}

export function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Eruv La Dehesa</p>
          <h1>Estado del Eruv</h1>
        </div>
        <button className="login-button">Ingresar</button>
      </header>

      <section className="status-card">
        <div>
          <span className="status-pill">Vista pública · Guest</span>
          <h2>Mapa del Eruv</h2>
          <p>
            Puedes consultar libremente el trazado y el estado semanal. Para reportar alertas o revisar pórticos será necesario iniciar sesión con una cuenta aprobada.
          </p>
        </div>
        <div className="status-placeholder">Trazado KMZ cargado</div>
      </section>

      <main className="map-wrap">
        <MapContainer
          bounds={ERUV_BOUNDS}
          boundsOptions={{ padding: [18, 18] }}
          scrollWheelZoom
          className="map"
        >
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <GeoJSON
            data={eruvData as any}
            style={featureStyle}
            onEachFeature={(feature, layer) => {
              const name = feature?.properties?.name
              if (name) layer.bindTooltip(name)
            }}
          />
        </MapContainer>
        <div className="map-note">
          Trazado importado desde tu KMZ original. La ubicación y numeración individual de los pórticos se afinará en la siguiente etapa.
        </div>
      </main>
    </div>
  )
}
