/** Header.jsx — Branded navigation for MAISON MIRO */
import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { useCart } from "../CartContext";

export default function Header() {
  const { user, logout } = useAuth();
  const { items } = useCart();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  function handleLogout() {
    logout();
    navigate("/");
    setMenuOpen(false);
  }

  const navLinkClass = ({ isActive }) =>
    "nav-link" + (isActive ? " nav-link--active" : "");

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link to="/" className="logo" onClick={() => setMenuOpen(false)}>
          <span className="logo-main">MAISON MIRO</span>
          <span className="logo-tag">Art for the spaces we call home.</span>
        </Link>

        <button
          className="nav-toggle"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span className="hamburger" />
        </button>

        <nav className={`site-nav${menuOpen ? " site-nav--open" : ""}`} aria-label="Main navigation">
          <NavLink to="/collection" className={navLinkClass} onClick={() => setMenuOpen(false)}>Collection</NavLink>
          <NavLink to="/wall-murals" className={navLinkClass} onClick={() => setMenuOpen(false)}>Wall Murals</NavLink>
          <NavLink to="/pottery" className={navLinkClass} onClick={() => setMenuOpen(false)}>Pottery</NavLink>

          {user ? (
            <>
              {user.role === "studio" && (
                <NavLink to="/studio" className={navLinkClass} onClick={() => setMenuOpen(false)}>Studio</NavLink>
              )}
              <NavLink to="/account" className={navLinkClass} onClick={() => setMenuOpen(false)}>My Account</NavLink>
              <button className="btn btn--ghost btn--sm" onClick={handleLogout}>Sign out</button>
            </>
          ) : (
            <NavLink to="/login" className={navLinkClass} onClick={() => setMenuOpen(false)}>Sign in</NavLink>
          )}

          <Link
            to="/cart"
            className="cart-icon"
            aria-label={`Cart (${items.length} item${items.length !== 1 ? "s" : ""})`}
            onClick={() => setMenuOpen(false)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 0 1-8 0"/>
            </svg>
            {items.length > 0 && <span className="cart-badge">{items.length}</span>}
          </Link>
        </nav>
      </div>
    </header>
  );
}
