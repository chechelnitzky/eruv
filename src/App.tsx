import { MapContainer, TileLayer } from 'react-leaflet'

const LA_DEHESA_CENTER: [number, number] = [-33.35, -70.52]

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
          <span className="status-pill">Vista pública</span>
          <h2>Mapa y estado semanal</h2>
          <p>
            Los visitantes pueden consultar el estado. Las alertas y revisiones estarán disponibles solo para usuarios aprobados.
          </p>
        </div>
        <div className="status-placeholder">Configurando pórticos…</div>
      </section>

      <main className="map-wrap">
        <MapContainer center={LA_DEHESA_CENTER} zoom={14} scrollWheelZoom className="map">
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        </MapContainer>
        <div className="map-note">
          El trazado y los pórticos precisos se cargarán desde el mapa KML/KMZ original.
        </div>
      </main>
    </div>
  )
}
