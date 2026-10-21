import { Link } from "react-router-dom";
import "./Entrance.css";

export default function Entrance() {
  return (
    <main className="atelier-gate">
      <div className="atelier-gate__texture" aria-hidden="true" />
      <div className="atelier-gate__frame" aria-hidden="true" />
      <img className="atelier-gate__floral atelier-gate__floral--left" src="/images/atelier-botanical.svg" alt="" aria-hidden="true" />
      <img className="atelier-gate__floral atelier-gate__floral--right" src="/images/atelier-botanical.svg" alt="" aria-hidden="true" />

      <section className="atelier-gate__content" aria-labelledby="atelier-wordmark">
        <p className="atelier-gate__established">EST. IN ART &amp; BEAUTY</p>
        <span className="atelier-gate__rule" aria-hidden="true"><i /></span>
        <h1 id="atelier-wordmark">MAISON MIRO</h1>
        <p className="atelier-gate__disciplines">ART <span>·</span> OBJECTS <span>·</span> SPACES</p>
        <p className="atelier-gate__tagline">Where art becomes part of your world.</p>
        <Link className="atelier-gate__enter" to="/home">
          ENTER THE STUDIO <span aria-hidden="true">→</span>
        </Link>
        <p className="atelier-gate__atelier">A CONTEMPORARY ART ATELIER</p>
      </section>
    </main>
  );
}
