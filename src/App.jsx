import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import { CartProvider, useCart } from "./CartContext";
import Header from "./components/Header";
import Entrance from "./components/Entrance";
import * as api from "./api";
import { cancelLocalOrder, getLocalOrders, localOrdersChangedEvent } from "./localOrders";
import heroImage from "./assets/hero.png";
import "./App.css";

const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const cartLineTotal = (item) => Number(item.unit_price || 0) * (item.type === "mural" ? Number(item.details.wall_size_sqft) : Number(item.quantity));
const day = (n) => { const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function Notice({ error, children }) { return error || children ? <p className={error ? "notice notice--error" : "notice"} role={error ? "alert" : "status"}>{error || children}</p> : null; }
function RequireAuth({ children, studio = false }) {
  const { user, loading } = useAuth();
  if (loading) return <main className="container"><p>Checking your account…</p></main>;
  if (!user) return <Navigate to="/login" replace />;
  if (studio && user.role !== "studio") return <main className="container"><h1>Studio access only</h1><p>This area is reserved for the studio team.</p><Link to="/">Return home</Link></main>;
  return children;
}
function Shell() { const isEntrance=useLocation().pathname==="/"; return <div className={isEntrance ? undefined : "interior-shell"}>{!isEntrance&&<Header/>}<Routes>
  <Route path="/" element={<Entrance/>}/><Route path="/home" element={<Home/>}/><Route path="/collection" element={<Collection/>}/><Route path="/artwork/:id" element={<Artwork/>}/>
  <Route path="/login" element={<AuthPage/>}/><Route path="/admin-login" element={<AuthPage admin/>}/><Route path="/register" element={<AuthPage register/>}/>
  <Route path="/account" element={<RequireAuth><Account/></RequireAuth>}/><Route path="/cart" element={<Cart/>}/><Route path="/checkout" element={<RequireAuth><Checkout/></RequireAuth>}/>
  <Route path="/wall-murals" element={<WallPage/>}/><Route path="/pottery" element={<PotteryPage/>}/>
  <Route path="/studio" element={<RequireAuth studio><Studio/></RequireAuth>}/><Route path="/studio/catalogue" element={<RequireAuth studio><ArtworkCataloguePage/></RequireAuth>}/><Route path="*" element={<main className="container"><h1>Page not found</h1><Link to="/">Return home</Link></main>}/>
</Routes>{!isEntrance&&<footer className="footer">MAISON MIRO <span>Art for the spaces we call home.</span></footer>}</div>; }
function App() { return <BrowserRouter><AuthProvider><CartProvider><Shell/></CartProvider></AuthProvider></BrowserRouter>; }

function usePaintings() {
  const [state, setState] = useState({ paintings: [], loading: true, error: "" });
  const reload = useCallback(() => api.fetchPaintings()
    .then((d) => setState({ paintings: d.paintings || [], loading: false, error: "" }))
    .catch((e) => setState({ paintings: [], loading: false, error: e.message || "Could not load the collection." })), []);
  useEffect(() => {
    reload();
  }, [reload]);
  return { ...state, reload };
}
function ArtworkGrid({ paintings }) { return <div className="art-grid">{paintings.map(p=><article className="art-card" key={p.id}><Link className="art-image" to={`/artwork/${p.id}`}><img src={p.image_url?.startsWith("http")?p.image_url:`/${p.image_url||""}`} alt={p.title}/>{p.status!=="available"&&<span className="sold-tag">Sold</span>}</Link><div className="art-copy"><p className="eyebrow">{p.artist}</p><h3>{p.title}</h3><p className="art-price">{money(p.price)}</p><Link className="text-link" to={`/artwork/${p.id}`}>View artwork ↗</Link></div></article>)}</div>; }
function Home() { const {paintings,loading,error}=usePaintings(); return <><section className="hero"><div className="hero-copy"><p className="eyebrow">Art made slowly, kept forever</p><h1>Bring home a story<br/><em>worth looking at.</em></h1><p>Original paintings, hand-finished pottery, and murals made for the spaces we call home.</p><Link className="btn" to="/collection">Explore the collection</Link></div><div className="hero-art"><img src={heroImage} alt="A curated glimpse into the MAISON MIRO art studio"/></div></section><section className="section container"><div className="section-heading"><div><p className="eyebrow">Selected works</p><h2>Art with a life of its own</h2></div><Link className="text-link" to="/collection">View all works ↗</Link></div>{loading?<p>Loading the collection…</p>:error?<Notice error={error}/>:<ArtworkGrid paintings={paintings.filter(p=>p.status==="available").slice(0,3)}/>}</section><section className="services"><div className="container"><p className="eyebrow">More from the studio</p><h2>Made for your walls, made by hand.</h2><div className="service-grid"><Link to="/wall-murals"><span>01 / Commission</span><h3>Wall murals</h3><p>Original, hand-painted work sized to your space.</p><b>Plan a mural ↗</b></Link><Link to="/pottery"><span>02 / Made to order</span><h3>Studio pottery</h3><p>Choose a form and glaze; we’ll make it for you.</p><b>Explore pottery ↗</b></Link></div></div></section></>; }
function Collection() { const {paintings,loading,error}=usePaintings(); const [q,setQ]=useState(""); const [status,setStatus]=useState("all"); const filtered=paintings.filter(p=>(status==="all"||p.status===status)&&`${p.title} ${p.artist} ${p.description||""}`.toLowerCase().includes(q.toLowerCase())); return <main className="container page"><p className="eyebrow">The collection</p><h1>Original works</h1><p className="intro">Each piece is one of a kind, made by artists working across the traditions and textures of India.</p><div className="filters"><label>Search works<input value={q} onChange={e=>setQ(e.target.value)} placeholder="Title, artist, or detail"/></label><label>Availability<select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All works</option><option value="available">Available</option><option value="sold">Sold</option></select></label></div>{loading?<p>Loading the collection…</p>:error?<Notice error={error}/>:filtered.length?<ArtworkGrid paintings={filtered}/>:<p className="empty">No works match those filters.</p>}</main>; }
function Artwork() {
  const { id } = useParams();
  const [painting, setPainting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api.fetchPainting(id).then((data) => { if (active) setPainting(data.painting); })
      .catch((err) => { if (active) setError(err.status === 404 ? "This artwork could not be found." : err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);
  if (loading) return <main className="container page">Loading artwork…</main>;
  if (error) return <main className="container page"><Notice error={error}/><Link to="/collection">Back to collection</Link></main>;
  return <main className="container page">
    <Link to="/collection" className="text-link">← Collection</Link>
    <div className="detail">
      <div className="detail-image"><img src={painting.image_url?.startsWith("http") ? painting.image_url : `/${painting.image_url || ""}`} alt={painting.title}/></div>
      <div className="detail-copy">
        <p className="eyebrow">{painting.artist}</p><h1>{painting.title}</h1>
        <p className="detail-price">{money(painting.price)}</p><p>{painting.description}</p>
        <p className={painting.status === "available" ? "availability" : "availability sold-text"}>
          {painting.status === "available" ? "Available · One of a kind" : "Sold"}
        </p>
        {painting.status === "available" ? <RequestArtwork painting={painting}/> : <button className="btn" disabled>Artwork sold</button>}
      </div>
    </div>
  </main>;
}

function RequestArtwork({ painting }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function request() {
    setBusy(true); setError(""); setMessage("");
    try {
      await api.createPaintingRequest(painting.id);
      setMessage("Your request was sent to the studio for review. You can follow its status in My Account.");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <>
    {user?.role === "customer" ? <button className="btn" type="button" disabled={busy} onClick={request}>{busy ? "Sending request…" : "Request Artwork"}</button> : user ? <p className="muted">A customer account is required to request artwork.</p> : <Link className="btn" to="/login">Sign in to request</Link>}
    <Notice error={error}>{message}</Notice>
  </>;
}
function AuthPage({register=false,admin=false}) {
  const {login,logout}=useAuth();
  const nav=useNavigate();
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  async function submit(e){
    e.preventDefault();setBusy(true);setError("");setMessage("");
    try{
      if(register){
        await api.apiRegister(email,password);
        setMessage("Customer account created. Sign in to continue.");
      }else{
        const user=await login(email,password);
        const expectedRole=admin?"studio":"customer";
        if(user.role!==expectedRole){
          logout();
          setError(admin
            ? "This account does not have Studio administrator access. Use Customer Sign In or contact the authorized project administrator."
            : "This is a Studio account. Please use Admin Sign In.");
          return;
        }
        nav(admin?"/studio":"/account");
      }
    }catch(err){setError(err.message||"Sign in failed. Please try again.");}
    finally{setBusy(false);}
  }
  const heading=register?"Create a customer account":admin?"Admin Sign In":"Customer Sign In";
  return <main className="auth-wrap">
    <div className="auth-panel">
      <nav className="auth-options" aria-label="Choose sign-in type">
        <Link className={!admin&&!register?"auth-option auth-option--active":"auth-option"} to="/login" aria-current={!admin&&!register?"page":undefined}>
          <span>For collectors</span><b>Customer Sign In</b>
        </Link>
        <Link className={admin?"auth-option auth-option--active":"auth-option"} to="/admin-login" aria-current={admin?"page":undefined}>
          <span>For the studio team</span><b>Admin Sign In</b>
        </Link>
      </nav>
      <form className="form-card" onSubmit={submit}>
        <p className="eyebrow">{register?"Join the collection":admin?"Private studio workspace":"Welcome back"}</p>
        <h1>{heading}</h1>
        {admin&&<p className="muted">Sign in with an authorized Studio account. Access is determined by your account role.</p>}
        <Notice error={error}>{message}</Notice>
        <label>Email<input type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></label>
        <label>Password<input type="password" required minLength={register?8:undefined} autoComplete={register?"new-password":"current-password"} value={password} onChange={e=>setPassword(e.target.value)}/></label>
        <button className="btn" disabled={busy}>{busy?"Please wait…":register?"Create customer account":admin?"Sign in to Studio":"Sign in to your account"}</button>
        {!admin&&!register&&<p className="muted">New to MAISON MIRO? <Link to="/register">Create a customer account</Link></p>}
        {register&&<p className="muted">Already have an account? <Link to="/login">Customer Sign In</Link></p>}
        {admin&&<p className="muted">Need a customer account? <Link to="/login">Customer Sign In</Link></p>}
        {register&&<p className="muted">Studio accounts are provisioned through the authorized private setup process.</p>}
      </form>
    </div>
  </main>;
}
function Cart(){const {items,removeFromCart}=useCart();const subtotal=items.reduce((sum,item)=>sum+cartLineTotal(item),0);return <main className="container page"><p className="eyebrow">Your selection</p><h1>Your bag</h1>{!items.length?<p className="empty">Your bag is empty. <Link to="/collection">Find a work to love.</Link></p>:<><div className="checkout-lines">{items.map(item=><article className="checkout-line" key={item.cartId}>{item.image_url&&<img src={`/${item.image_url}`} alt=""/>}<div className="checkout-line-main"><p className="eyebrow">{item.type}</p><h3>{item.name}</h3>{item.type==="pottery"&&<p>{item.details.glaze_name} · Needed by {item.details.needed_by}</p>}{item.type==="mural"&&<p>{item.details.wall_size_sqft} sq ft · {String(item.details.booking_date).slice(0,10)} · estimate subject to studio assessment</p>}</div><div className="line-price"><span>{money(item.unit_price)} / {item.type==="mural"?"sq ft":item.type==="pottery"?(item.price_unit||"item"):"item"}</span><span>Qty {item.quantity}</span><b>Line total: {money(cartLineTotal(item))}</b><button className="text-link" onClick={()=>removeFromCart(item.cartId)}>Remove</button></div></article>)}</div><div className="checkout-total"><div><span>Subtotal</span><b>{money(subtotal)}</b></div><div><span>Estimated total</span><b>{money(subtotal)}</b></div><p className="muted">Mural totals are estimates and may change after studio assessment. No delivery fee, tax, or online payment is added.</p><Link className="btn" to="/checkout">Proceed to Checkout</Link></div></>}</main>;}

function Checkout() {
  const { items, clearCart } = useCart();
  const [address, setAddress] = useState({ full_name: "", phone: "", house: "", street: "", locality: "", city: "", state: "", pin_code: "", instructions: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const placing = useRef(false);
  const checkoutKey = useRef(null);
  const subtotal = items.reduce((sum, item) => sum + cartLineTotal(item), 0);
  function field(name) { return (event) => setAddress((current) => ({ ...current, [name]: event.target.value })); }
  async function submit(event) {
    event.preventDefault();
    setError("");
    if (placing.current) return;
    if (!items.length) { setError("Your bag is empty."); return; }
    if (items.some((item) => item.type === "painting" && !item.request_id)) {
      setError("Paintings can only be checked out after the studio approves your artwork request. Remove this item and add it from an approved request in My Account.");
      return;
    }
    if (items.some((item) => !Number.isFinite(Number(item.unit_price)) || Number(item.unit_price) <= 0 || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1 || Number(item.quantity) > 12)) {
      setError("A cart item has an invalid price or quantity. Please review your bag.");
      return;
    }
    if (items.some((item) => item.type === "mural" && (!Number.isInteger(Number(item.details?.wall_size_sqft)) || Number(item.details.wall_size_sqft) < 10 || Number(item.details.wall_size_sqft) > 500))) {
      setError("Please check the mural wall dimensions in your bag.");
      return;
    }
    placing.current = true;
    setBusy(true);
    try {
      const checkoutPayload = {
        payment_method: "cod",
        delivery_address: address,
        items: items.map((item) => ({
          type: item.type || "painting",
          id: String(item.id),
          request_id: item.request_id,
          quantity: Number(item.quantity),
          details: item.details || {},
        })),
      };
      const signature = JSON.stringify(checkoutPayload);
      if (checkoutKey.current?.signature !== signature) {
        checkoutKey.current = { signature, key: window.crypto.randomUUID() };
      }
      const response = await api.createCheckoutOrder({ ...checkoutPayload, checkout_key: checkoutKey.current.key });
      setConfirmation(response.order);
      checkoutKey.current = null;
      clearCart();
    } catch (err) {
      setError(err.message || "We could not place this order. Your bag has been kept so you can try again.");
    } finally {
      placing.current = false;
      setBusy(false);
    }
  }
  if (confirmation) {
    const order = confirmation;
    const savedAddress = order.delivery_address || address;
    return <main className="container page">
      <p className="eyebrow">Order received</p><h1>Order Placed Successfully</h1>
      <Notice>Order #{order.id} has been recorded by the studio server. Payment is Cash on Delivery; no payment has been collected.</Notice>
      <div className="confirmation-card">
        <h2>Order details</h2>
        <p>Status: {order.status} · Placed {new Date(order.created_at).toLocaleDateString("en-IN")}</p>
        <p>Payment: Cash on Delivery</p>
        <div className="record-list">{(order.items || []).map((line, index) => <article key={line.id || index}><b>{line.name} × {line.quantity}{line.type === "mural" && " · " + line.details.wall_size_sqft + " sq ft"}</b><span>{money(line.line_total)} · {line.item_status || line.status}</span></article>)}</div>
        <h3>Total: {money(order.total_amount)}</h3><h3>Delivery address</h3>
        <p>{savedAddress.full_name} · {savedAddress.phone}<br />{savedAddress.house}, {savedAddress.street}, {savedAddress.locality}<br />{savedAddress.city}, {savedAddress.state} {savedAddress.pin_code}{savedAddress.instructions && <><br />Instructions: {savedAddress.instructions}</>}</p>
        <Link className="btn" to="/account">View order history</Link>
      </div>
    </main>;
  }
  return <main className="container page"><p className="eyebrow">One final step</p><h1>Checkout</h1>
    {!items.length ? <p className="empty">Your bag is empty. <Link to="/collection">Browse the collection.</Link></p> :
      <form className="checkout-form" onSubmit={submit}>
        <section className="form-card address-card"><p className="eyebrow">Required for delivery</p><h2>Delivery Address</h2>
          <p className="muted">Enter the address for paintings and pottery. No saved address is available for this account.</p>
          <div className="address-fields">
            <label>Full name<input autoComplete="name" required maxLength="180" value={address.full_name} onChange={field("full_name")}/></label>
            <label>Phone number<input type="tel" autoComplete="tel" required pattern="[+]?[0-9 ()-]{10,18}" value={address.phone} onChange={field("phone")}/></label>
            <label>House / flat number<input required maxLength="180" autoComplete="address-line1" value={address.house} onChange={field("house")}/></label>
            <label>Street<input required maxLength="180" value={address.street} onChange={field("street")}/></label>
            <label>Area / locality<input required maxLength="180" autoComplete="address-line2" value={address.locality} onChange={field("locality")}/></label>
            <label>City<input required maxLength="180" autoComplete="address-level2" value={address.city} onChange={field("city")}/></label>
            <label>State<input required maxLength="180" autoComplete="address-level1" value={address.state} onChange={field("state")}/></label>
            <label>PIN code<input required inputMode="numeric" pattern="[0-9]{6}" maxLength="6" autoComplete="postal-code" value={address.pin_code} onChange={field("pin_code")}/></label>
          </div>
          <label>Optional delivery instructions<textarea maxLength="500" value={address.instructions} onChange={field("instructions")}/></label>
        </section>
        <section className="form-card"><p className="eyebrow">Payment</p><h2>Cash on Delivery</h2><label className="cod-choice"><input type="radio" name="payment" value="cod" checked readOnly/> Pay when the order is delivered or the service arrangement is confirmed.</label></section>
        <section className="form-card"><p className="eyebrow">Review</p><h2>Items in this order</h2>
          {items.map((item) => <article className="review-item" key={item.cartId}><div><b>{item.name}</b><p>{item.type} · qty {item.quantity} · {money(item.unit_price)} each</p>{item.type === "mural" && <p className="muted">{item.details.wall_size_sqft} sq ft · approved date {item.details.booking_date} · estimate subject to studio assessment</p>}{item.type === "pottery" && <p className="muted">{item.details.glaze_name} · needed by {item.details.needed_by}</p>}</div><b>{money(cartLineTotal(item))}</b></article>)}
          <div className="checkout-total compact"><div><span>Subtotal</span><b>{money(subtotal)}</b></div><div><span>Estimated total</span><b>{money(subtotal)}</b></div><p className="muted">COD only. Mural totals are estimates subject to studio assessment. The server validates request approvals and prices when you place the order.</p><Notice error={error}/><button className="btn" disabled={busy}>{busy ? "Placing order…" : "Place Order"}</button></div>
        </section>
      </form>}
  </main>;
}
const accountSections = [
  { id: "artwork", label: "Artwork Requests", icon: "artwork" },
  { id: "murals", label: "Mural Requests", icon: "mural" },
  { id: "pottery", label: "Pottery Requests", icon: "pottery" },
  { id: "orders", label: "Orders", icon: "orders" },
];
function SectionIcon({ name }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
  return <svg className="section-tab__icon" viewBox="0 0 24 24" aria-hidden="true" {...common}>
    {name === "artwork" && <><rect x="3.5" y="4" width="17" height="16" rx="1.5"/><circle cx="9" cy="9" r="1.5"/><path d="m4 17 5-5 3.5 3 2.5-2 5 4"/></>}
    {name === "mural" && <><path d="M4 20V5.5A1.5 1.5 0 0 1 5.5 4H10v16M14 20V4h4.5A1.5 1.5 0 0 1 20 5.5V20M3 20h18"/><path d="M7 8h.01M17 8h.01M7 12h.01M17 12h.01"/></>}
    {name === "pottery" && <><path d="M8 4h8l-1 3c2.6 1.3 4 3.4 4 6.1 0 3.7-2.8 6.4-7 6.4s-7-2.7-7-6.4c0-2.7 1.4-4.8 4-6.1L8 4Z"/><path d="M8 7h8M7.5 13h9"/></>}
    {name === "orders" && <><path d="M5 8h14l1 12H4L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/></>}
  </svg>;
}

function SectionTabs({ tabs, active, onSelect, label, idPrefix }) {
  return <div className="section-tabs" role="tablist" aria-label={label}>
    {tabs.map((tab) => <button key={tab.id} type="button" role="tab" id={`${idPrefix}-tab-${tab.id}`} aria-controls={`${idPrefix}-panel-${tab.id}`} aria-selected={active === tab.id} className={`section-tab${active === tab.id ? " section-tab--active" : ""}`} onClick={() => onSelect(tab.id)}>
      <SectionIcon name={tab.icon}/><span>{tab.label}</span>
    </button>)}
  </div>;
}

function SectionPanel({ idPrefix, section, active, children }) {
  return <div role="tabpanel" id={`${idPrefix}-panel-${section.id}`} aria-labelledby={`${idPrefix}-tab-${section.id}`} tabIndex={0} hidden={!active}>{children}</div>;
}

function Account(){
  const { user } = useAuth();
  const { addToCart } = useCart();
  const ownerId = user?.id || user?.email;
  const [serverOrders, setServerOrders] = useState([]);
  const [localOrders, setLocalOrders] = useState(() => getLocalOrders(ownerId));
  const [bookings, setBookings] = useState([]);
  const [paintingRequests, setPaintingRequests] = useState([]);
  const [potteryRequests, setPotteryRequests] = useState([]);
  const [error, setError] = useState("");
  const [serverOrderUnavailable, setServerOrderUnavailable] = useState(false);
  const [confirmCancelId, setConfirmCancelId] = useState(null);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const [busyRequestId, setBusyRequestId] = useState("");
  const [activeSection, setActiveSection] = useState("artwork");
  const [activeOrderTab, setActiveOrderTab] = useState("active");
  const cancelGuard = useRef(false);
  const load = useCallback(async () => {
    const results = await Promise.allSettled([
      api.fetchMyOrders(), api.fetchMyWallBookings(), api.fetchMyPaintingRequests(), api.fetchMyPotteryRequests(),
    ]);
    const errors = [];
    if (results[0].status === "fulfilled") { setServerOrders(results[0].value.orders || []); setServerOrderUnavailable(false); }
    else setServerOrderUnavailable(true);
    if (results[1].status === "fulfilled") setBookings(results[1].value.bookings || []);
    else { setBookings([]); errors.push(`Mural bookings could not be loaded: ${results[1].reason.message}`); }
    if (results[2].status === "fulfilled") setPaintingRequests(results[2].value.requests || []);
    else { setPaintingRequests([]); errors.push(`Artwork requests could not be loaded: ${results[2].reason.message}`); }
    if (results[3].status === "fulfilled") setPotteryRequests(results[3].value.requests || []);
    else { setPotteryRequests([]); errors.push(`Pottery requests could not be loaded: ${results[3].reason.message}`); }
    setError(errors.join(" "));
  }, []);
  useEffect(() => {
    Promise.resolve().then(load);
    const refreshLocal = () => setLocalOrders(getLocalOrders(ownerId));
    window.addEventListener(localOrdersChangedEvent(), refreshLocal);
    return () => window.removeEventListener(localOrdersChangedEvent(), refreshLocal);
  }, [load, ownerId]);
  const orders = [...localOrders, ...serverOrders].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  const isPastOrder = (order) => ["delivered", "cancelled"].includes(String(order.status || "").trim().toLowerCase());
  const visibleOrders = orders.filter((order) => activeOrderTab === "past" ? isPastOrder(order) : !isPastOrder(order));
  async function cancel(order) {
    if (cancelGuard.current || order.status !== "placed") return;
    cancelGuard.current = true; setCancellingOrderId(order.id); setError("");
    try {
      if (order.local_only) setLocalOrders(getLocalOrders(ownerId).map((entry) => entry.id === order.id ? cancelLocalOrder(ownerId, order.id) : entry));
      else await api.cancelOrder(order.id);
      setConfirmCancelId(null); await load();
    } catch (err) { setError(`Could not cancel the order: ${err.message}`); }
    finally { cancelGuard.current = false; setCancellingOrderId(null); }
  }
  async function act(fn) {
    try { await fn(); await load(); }
    catch (err) { setError(err.message); }
  }
  async function addPaintingRequest(request) {
    setBusyRequestId(request.id); setError("");
    try {
      const { painting } = await api.validatePaintingRequestForCart(request.id);
      addToCart({ type: "painting", id: painting.id, request_id: request.id, name: painting.title, artist: painting.artist, image_url: painting.image_url, unit_price: Number(painting.price), quantity: 1 });
    } catch (err) { setError(err.message); await load(); }
    finally { setBusyRequestId(""); }
  }
  async function addMuralRequest(booking) {
    setBusyRequestId(booking.id); setError("");
    try {
      const { booking: approved } = await api.validateWallBookingForCart(booking.id);
      addToCart({ type: "mural", id: approved.id, request_id: approved.id, name: "Wall mural service", quantity: 1, unit_price: Number(approved.rate_per_sqft), details: { wall_size_sqft: approved.wall_size_sqft, booking_date: String(approved.booking_date).slice(0,10), service_address: approved.address } });
    } catch (err) { setError(err.message); await load(); }
    finally { setBusyRequestId(""); }
  }
  async function addPotteryRequest(request) {
    setBusyRequestId(request.id); setError("");
    try {
      const { request: approved } = await api.validatePotteryRequestForCart(request.id);
      addToCart({ type: "pottery", id: String(approved.item_id), request_id: String(approved.id), name: approved.item_name, quantity: Number(approved.quantity), unit_price: Number(approved.price_per_item), price_unit: approved.price_unit, details: { glaze_id: String(approved.glaze_id), glaze_name: approved.glaze_name, needed_by: String(approved.needed_by).slice(0, 10) } });
    } catch (err) { setError(err.message); await load(); }
    finally { setBusyRequestId(""); }
  }
  const requestStatus = (status) => ({ pending: "Pending", approved: "Approved", declined: "Declined", cancelled: "Cancelled", purchased: "Purchased", requested: "Pending", confirmed: "Approved" }[status] || status);
  return <main className="container page">
    <p className="eyebrow">Your studio account</p><h1>Your requests &amp; orders</h1>
    <SectionTabs tabs={accountSections} active={activeSection} onSelect={setActiveSection} label="Your account sections" idPrefix="account"/>
    <Notice error={error}/>
    <SectionPanel idPrefix="account" section={accountSections[0]} active={activeSection === "artwork"}>
    <h2>Artwork requests</h2>
    <RecordList rows={paintingRequests} empty="You have not requested artwork yet." render={(request) => <div className="request-record">
      <div><b>{request.title}</b><p className="muted">{request.artist} · {money(request.price)} · Requested {new Date(request.created_at).toLocaleDateString("en-IN")}</p>
        <span className={`request-status request-status--${request.status}`}>{requestStatus(request.status)}</span>
        {request.status === "declined" && <p className="muted">The studio declined this request. You cannot purchase this artwork through this request.</p>}
      </div>
      <div className="request-record__actions">
        {request.status === "approved" && !request.order_item_id && <button className="btn btn--sm" disabled={busyRequestId === request.id} onClick={() => addPaintingRequest(request)}>{busyRequestId === request.id ? "Checking…" : "Add to Cart"}</button>}
        {request.status === "approved" && !request.order_item_id && <button className="text-link" disabled={busyRequestId === request.id} onClick={() => act(() => api.cancelPaintingRequest(request.id))}>Cancel Request</button>}
      </div>
    </div>}/>
    </SectionPanel>
    <SectionPanel idPrefix="account" section={accountSections[1]} active={activeSection === "murals"}>
    <h2>Wall mural requests</h2>
    <RecordList rows={bookings} empty="No mural requests yet." render={(booking) => <div className="request-record">
      <div><b>{String(booking.booking_date).slice(0,10)} · {booking.wall_size_sqft} sq ft</b><p className="muted">{money(booking.total_price)} estimate · {booking.address}</p><span className={`request-status request-status--${booking.status}`}>{requestStatus(booking.status)}</span>
        {booking.status === "declined" && <p className="muted">The studio declined this mural request. You cannot add it to the cart.</p>}
      </div>
      <div className="request-record__actions">
        {booking.status === "confirmed" && !booking.order_item_id && <button className="btn btn--sm" disabled={busyRequestId === booking.id} onClick={() => addMuralRequest(booking)}>{busyRequestId === booking.id ? "Checking…" : "Add to Cart"}</button>}
        {["requested", "confirmed"].includes(booking.status) && !booking.order_item_id && <button className="text-link" disabled={busyRequestId === booking.id} onClick={() => act(() => api.cancelWallBooking(booking.id))}>Cancel Request</button>}
        {booking.order_item_id && <span className="muted">Added to an order</span>}
      </div>
    </div>}/>
    </SectionPanel>
    <SectionPanel idPrefix="account" section={accountSections[2]} active={activeSection === "pottery"}>
    <h2>Pottery requests</h2>
    <RecordList rows={potteryRequests} empty="No pottery requests yet." render={(request) => <><b>{request.quantity} × {request.item_name}</b><span>{request.glaze_name} · needed {String(request.needed_by).slice(0,10)} · {request.status}</span>{request.status === "accepted" && !request.order_item_id && <button className="btn btn--sm" disabled={busyRequestId === request.id} onClick={() => addPotteryRequest(request)}>{busyRequestId === request.id ? "Checking…" : "Add to Bag"}</button>}{request.status === "requested" && <button className="text-link" disabled={busyRequestId === request.id} onClick={() => act(() => api.updatePotteryRequest(request.id,{status:"cancelled"}))}>Cancel request</button>}{request.order_item_id && <span className="muted">Added to an order</span>}</>}/>
    </SectionPanel>
    <SectionPanel idPrefix="account" section={accountSections[3]} active={activeSection === "orders"}>
    <h2>Orders</h2>
    <div className="request-filters order-subtabs" role="group" aria-label="Order status view">
      {[{ id: "active", label: "Active Orders" }, { id: "past", label: "Past Orders" }].map((tab) => <button key={tab.id} type="button" className={`request-filter${activeOrderTab === tab.id ? " request-filter--active" : ""}`} aria-pressed={activeOrderTab === tab.id} onClick={() => setActiveOrderTab(tab.id)}>{tab.label}</button>)}
    </div>
    {!localOrders.length && !serverOrders.length && serverOrderUnavailable && <p className="muted">Older server-saved order history is unavailable right now. Orders saved on this device are still shown below.</p>}
    <RecordList rows={visibleOrders} empty={activeOrderTab === "active" ? "No active orders yet." : "No past orders yet."} render={(o) => <div className="order-history">
      <div className="order-history-head"><b>Order #{o.id}{o.local_only&&<span className="local-order-label"> · This device only</span>}</b><span>{o.status === "cancelled" ? "Cancelled" : o.status} · {o.payment_method === "cod" ? "Cash on Delivery" : "Legacy purchase"} · {money(o.total_amount)}</span></div>
      <p className="order-date">Placed {o.created_at ? new Date(o.created_at).toLocaleDateString("en-IN") : "Date unavailable"}</p>
      <details className="order-details"><summary>View items and order details</summary><ul>{(o.items||[]).map((line,i)=><li key={line.id||i}>{line.name} × {line.quantity} — {money(line.unit_price)} each · line total {money(line.line_total)} <span className="pending-label">{line.item_status||line.status}</span>{line.type==="mural"&&<small>{line.details?.wall_size_sqft} sq ft · {line.details?.booking_date} · service address: {line.details?.service_address||"same as delivery address"} · estimate pending studio assessment</small>}{line.type==="pottery"&&<small>{line.details?.glaze_name} · needed by {line.details?.needed_by}</small>}</li>)}</ul>
        {o.delivery_address?<p className="address-summary"><b>Delivery:</b> {o.delivery_address.full_name}, {o.delivery_address.house}, {o.delivery_address.street}, {o.delivery_address.locality}, {o.delivery_address.city}, {o.delivery_address.state} {o.delivery_address.pin_code} · {o.delivery_address.phone}{o.delivery_address.instructions&&<> · Instructions: {o.delivery_address.instructions}</>}</p>:!o.local_only&&<p className="muted">A delivery address was not stored with this older server order.</p>}
        {o.local_only&&<p className="local-order-note">This legacy order is saved in this browser only. It is not visible to the studio and may not appear on another device.</p>}
      </details>
      {o.status === "placed" && (confirmCancelId === o.id ? <div className="cancel-confirm" role="group" aria-label={`Confirm cancellation of order ${o.id}`}><p>Cancel this entire order and all of its items?</p><button className="btn btn--sm" disabled={cancellingOrderId === o.id} onClick={() => cancel(o)}>{cancellingOrderId === o.id ? "Cancelling…" : "Confirm cancellation"}</button><button className="btn btn--ghost btn--sm" disabled={cancellingOrderId === o.id} onClick={() => setConfirmCancelId(null)}>Keep order</button></div> : <button className="text-link" disabled={cancellingOrderId === o.id} onClick={() => setConfirmCancelId(o.id)}>Cancel order</button>)}
    </div>}/>
    </SectionPanel>
  </main>;
}
function RecordList({rows,empty,render}){return rows.length?<div className="record-list">{rows.map((r,i)=><article key={r.id||i}>{render(r)}</article>)}</div>:<p className="muted">{empty}</p>;}
function WallPage(){
  const {user}=useAuth();
  const [date,setDate]=useState(day(7)),[size,setSize]=useState(20),[address,setAddress]=useState("");
  const [estimate,setEstimate]=useState(null),[estimateError,setEstimateError]=useState(null),[message,setMessage]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;api.fetchWallEstimate(size).then(d=>{if(active)setEstimate({...d.estimate,size:Number(size)});}).catch(e=>{if(active)setEstimateError({size:Number(size),message:e.message});});return()=>{active=false;};},[size]);
  const currentEstimate=estimate?.size===Number(size)?estimate:null;
  const currentEstimateError=estimateError?.size===Number(size)?estimateError.message:"";
  async function submit(e){e.preventDefault();setBusy(true);setError("");setMessage("");try{const d=await api.createWallBooking({booking_date:date,wall_size_sqft:Number(size),address});setMessage(`Mural request received. Estimated total: ${money(d.booking.total_price)}. The studio will review the date and final quote. Status: pending.`);setAddress("");}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <main className="container page"><p className="eyebrow">Commission the studio</p><h1>Wall murals</h1><p className="intro">A hand-painted mural, conceived for the architecture and rhythm of your home. Share your wall dimensions, address, and a preferred date; the studio will review your request.</p><div className="two-col"><div className="service-note"><h2>A considered process</h2><p>Dates are available 7–90 days ahead. The studio calculates your estimate from the configured rate; a booking is approved only after studio review.</p><p>Wall size: 10–500 sq ft. One active request per available date.</p></div>{user?.role === "studio" ? <div className="form-card"><h2>Studio request management</h2><p className="muted">Mural requests are managed in My Studio.</p><Link className="text-link" to="/studio">Open My Studio</Link></div> : user ? <form className="form-card" onSubmit={submit}><h2>Request a visit</h2><Notice error={error}>{message}</Notice><label>Preferred date<input type="date" min={day(7)} max={day(90)} required value={date} onChange={e=>setDate(e.target.value)}/></label><label>Wall size (sq ft)<input type="number" min="10" max="500" required value={size} onChange={e=>setSize(e.target.value)}/></label><p className="muted" aria-live="polite">{currentEstimate?`Estimated price: ${money(currentEstimate.rate_per_sqft)} per sq ft × ${size} sq ft = ${money(currentEstimate.total_price)}.`:currentEstimateError?`Estimate unavailable: ${currentEstimateError}`:"Calculating estimate…"} Final quote may require studio assessment.</p><label>Project address<textarea required value={address} onChange={e=>setAddress(e.target.value)}/></label><button className="btn" disabled={busy||!currentEstimate}>{busy?"Sending…":"Submit Mural Request"}</button><p className="muted">Add to Cart becomes available after the studio approves your request. Check My Account for its status.</p></form> : <SignInPrompt/>}</div></main>;
}
function SignInPrompt(){return <div className="form-card"><h2>Ready to begin?</h2><p>Sign in to send a request and see its status in your account.</p><Link className="btn" to="/login">Sign in</Link></div>;}
function PotteryPage(){const {user}=useAuth(),[items,setItems]=useState([]),[glazes,setGlazes]=useState([]),[item,setItem]=useState(""),[glaze,setGlaze]=useState(""),[qty,setQty]=useState(1),[date,setDate]=useState(day(14)),[message,setMessage]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);useEffect(()=>{Promise.all([api.fetchPotteryItems(),api.fetchGlazes()]).then(([a,b])=>{setItems(a.items||[]);setGlazes(b.glazes||[]);}).catch(e=>setError(e.message));},[]);const selectedItem=items.find(i=>String(i.id)===item);const quantity=Number(qty);const estimate=selectedItem?.price_per_item&&Number.isInteger(quantity)&&quantity>=1&&quantity<=12?selectedItem.price_per_item*quantity:null;async function submit(e){e.preventDefault();setBusy(true);setError("");setMessage("");try{const d=await api.createPotteryRequest({item_id:item,glaze_id:glaze,quantity,needed_by:date});setMessage(`Request received. Server-calculated estimate: ${money(d.price_per_item)} per ${d.price_unit} · ${money(d.estimated_total)} total. Status: ${d.request.status}. You can add it to your bag after Studio approval.`);}catch(e){setError(e.message);}finally{setBusy(false);}}return <main className="container page"><p className="eyebrow">Made to order</p><h1>Studio pottery</h1><p className="intro">Choose a form, choose its glaze, and tell us when you hope to have it. Each piece is made in small batches by hand.</p>{error&&!items.length?<Notice error={error}/>:<><div className="pottery-grid">{items.map(i=><article key={i.id}><p className="eyebrow">Studio form</p><h3>{i.name}</h3><p>{i.description||"Handmade in our studio."}</p>{i.price_per_item!=null&&<p className="art-price">{money(i.price_per_item)} per {i.price_unit}</p>}</article>)}</div>{user?.role === "studio" ? <div className="form-card request-form"><h2>Studio request management</h2><p className="muted">Pottery requests are managed in My Studio.</p><Link className="text-link" to="/studio">Open My Studio</Link></div> : user ? <form className="form-card request-form" onSubmit={submit}><h2>Request a piece</h2><Notice error={error}>{message}</Notice><label>Pottery item<select required value={item} onChange={e=>setItem(e.target.value)}><option value="">Choose a form</option>{items.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label><label>Glaze<select required value={glaze} onChange={e=>setGlaze(e.target.value)}><option value="">Choose a glaze</option>{glazes.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label><label>Quantity<input type="number" min="1" max="12" required value={qty} onChange={e=>setQty(e.target.value)}/></label><label>Needed by<input type="date" min={day(14)} required value={date} onChange={e=>setDate(e.target.value)}/></label><p className="muted" aria-live="polite">{estimate!==null?`Estimated price: ${money(selectedItem.price_per_item)} per ${selectedItem.price_unit} × ${quantity} = ${money(estimate)}.`:item?"Price unavailable for the selected pottery item.":"Select an item and quantity to see an estimate."} Glaze has no additional charge.</p><button className="btn" disabled={busy||!items.length||!glazes.length||estimate===null}>{busy?"Sending…":"Confirm Request"}</button></form> : <SignInPrompt/>}</>}</main>;}
function FilteredRequests({ rows, kind, busyId, onDecision }) {
  const [filter, setFilter] = useState("pending");
  const filters = ["all", "pending", "approved", "declined", "cancelled"];
  const statusOf = (row) => row.status === "requested" ? "pending" : row.status === "confirmed" ? "approved" : row.status;
  const visible = rows.filter((row) => filter === "all" || statusOf(row) === filter);
  const label = (status) => ({ requested: "Pending", pending: "Pending", confirmed: "Approved", approved: "Approved", declined: "Declined", cancelled: "Cancelled", purchased: "Purchased" }[status] || status);
  return <section className="studio-requests">
    <div className="request-filters" role="group" aria-label={kind + " request status filter"}>
      {filters.map((value) => <button key={value} type="button" className={"request-filter" + (filter === value ? " request-filter--active" : "")} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
    </div>
    {!visible.length ? <p className="muted">No {filter === "all" ? "" : filter + " "}{kind.toLowerCase()} requests.</p> :
      <div className="studio-request-list">{visible.map((request) => <article className="studio-request" key={request.id}>
        {kind === "Artwork" ? <>
          <div><p className="eyebrow">{request.customer_email}</p><h3>{request.title}</h3><p>{request.artist} · {money(request.price)}</p><small>Requested {new Date(request.created_at).toLocaleString("en-IN")}</small></div>
        </> : <>
          <div><p className="eyebrow">{request.customer_email}</p><h3>{String(request.booking_date).slice(0,10)} · {request.wall_size_sqft} sq ft</h3><p>{request.address}</p><p>{money(request.total_price)} estimate · {request.rate_per_sqft}/sq ft</p><small>Requested {new Date(request.created_at).toLocaleString("en-IN")}</small></div>
        </>}
        <div className="studio-request__decision"><span className={"request-status request-status--" + statusOf(request)}>{label(request.status)}</span>
          {statusOf(request) === "pending" && <div className="actions">
            <button className="text-link" disabled={busyId === request.id} onClick={() => onDecision(request, kind === "Artwork" ? "approved" : "confirmed")}>{busyId === request.id ? "Saving…" : "Approve"}</button>
            <button className="text-link" disabled={busyId === request.id} onClick={() => onDecision(request, "declined")}>Decline</button>
          </div>}
        </div>
      </article>)}</div>}
  </section>;
}

const emptyPaintingForm = { title: "", artist: "", description: "", price: "", image_url: "", status: "available" };

function ArtworkManagement({ paintings, onRefresh }) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyPaintingForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function startAdd() {
    setEditingId(null);
    setForm(emptyPaintingForm);
    setError("");
    setMessage("");
    setFormOpen(true);
  }

  function startEdit(painting) {
    setEditingId(painting.id);
    setForm({
      title: painting.title || "",
      artist: painting.artist || "",
      description: painting.description || "",
      price: painting.price ?? "",
      image_url: painting.image_url || "",
      status: painting.status || "available",
    });
    setError("");
    setMessage("");
    setFormOpen(true);
  }

  function cancelForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(emptyPaintingForm);
    setError("");
  }

  async function save(event) {
    event.preventDefault();
    const price = Number(form.price);
    if (!form.title.trim() || !form.artist.trim()) return setError("Title and artist are required.");
    if (!form.price.trim() || !Number.isFinite(price) || price < 0) return setError("Enter a valid non-negative price.");
    if (!form.image_url.trim()) return setError("An image path or URL is required.");
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = { ...form, title: form.title.trim(), artist: form.artist.trim(), description: form.description.trim(), price };
      if (editingId) await api.updateAdminPainting(editingId, payload);
      else await api.createAdminPainting(payload);
      setMessage(editingId ? "Artwork updated successfully." : "Artwork added successfully.");
      setFormOpen(false);
      setEditingId(null);
      setForm(emptyPaintingForm);
      await onRefresh();
    } catch (err) {
      setError(err.message || "Could not save artwork.");
    } finally {
      setSaving(false);
    }
  }

  const previewUrl = /^https?:\/\//i.test(form.image_url.trim())
    ? form.image_url.trim()
    : `/${form.image_url.trim().replace(/^\/+/, "")}`;

  return <section className="artwork-admin" aria-labelledby="artwork-admin-title">
    <div className="artwork-admin__heading">
      <div><h3 id="artwork-admin-title">Artwork catalogue</h3><p className="muted">Add a painting or update its customer-facing details.</p></div>
      {!formOpen && <button className="btn btn--sm" type="button" onClick={startAdd}>Add Artwork</button>}
    </div>
    {message && <Notice>{message}</Notice>}
    {error && <Notice error={error}/>}
    {formOpen && <form className="form-card artwork-admin-form" onSubmit={save}>
      <h3>{editingId ? "Edit Artwork" : "Add Artwork"}</h3>
      <label>Title<input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })}/></label>
      <label>Artist<input required value={form.artist} onChange={(event) => setForm({ ...form, artist: event.target.value })}/></label>
      <label>Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })}/></label>
      <label>Price (₹)<input required type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })}/></label>
      <label>Image path or URL<input required type="text" placeholder="images/p-001.jpg or https://…" value={form.image_url} onChange={(event) => setForm({ ...form, image_url: event.target.value })}/></label>
      <label>Status<select required value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="available">Available</option><option value="sold">Sold</option></select></label>
      {form.image_url.trim() && <div className="artwork-admin-preview-wrap"><span className="muted">Image preview</span><img className="artwork-admin-preview" src={previewUrl} alt="Artwork preview" onError={(event) => { event.currentTarget.hidden = true; }}/></div>}
      <div className="actions"><button className="btn btn--sm" type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? "Save Changes" : "Add Artwork"}</button><button className="btn btn--ghost btn--sm" type="button" disabled={saving} onClick={cancelForm}>Cancel</button></div>
    </form>}
    <RecordList rows={paintings} empty="No artwork could be loaded from the catalogue." render={(painting) => <div className="artwork-admin-row">
      <img src={/^https?:\/\//i.test(painting.image_url || "") ? painting.image_url : `/${String(painting.image_url || "").replace(/^\/+/, "")}`} alt="" onError={(event) => { event.currentTarget.hidden = true; }}/>
      <div className="artwork-admin-row__details"><b>{painting.title}</b><span>{painting.artist} · {money(painting.price)} · {painting.status}</span></div>
      <button className="text-link" type="button" onClick={() => startEdit(painting)}>Edit</button>
    </div>}/>
  </section>;
}

function ArtworkCataloguePage() {
  const [paintings, setPaintings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.fetchPaintings();
      setPaintings(result.paintings || []);
    } catch (err) {
      setError(err.message || "Could not load the artwork catalogue.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { Promise.resolve().then(load); }, [load]);
  return <main className="container page">
    <p className="eyebrow">Private workspace</p><h1>Artwork Catalogue</h1>
    <p className="intro">Add new paintings and maintain the details shown in the customer collection.</p>
    <Link className="text-link" to="/studio">Return to My Studio</Link>
    <Notice error={error}/>
    {loading && <p role="status">Loading artwork catalogue…</p>}
    <ArtworkManagement paintings={paintings} onRefresh={load}/>
  </main>;
}

function Studio() {
  const [data, setData] = useState({ orders: [], bookings: [], paintingRequests: [], potteryRequests: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [potteryFilter, setPotteryFilter] = useState("pending");
  const [orderFilter, setOrderFilter] = useState("all");
  const [activeSection, setActiveSection] = useState("artwork");
  const load = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([api.fetchAdminOrders(), api.fetchAdminWallBookings(), api.fetchAdminPaintingRequests(), api.fetchAdminPotteryRequests()]);
    const errors = [];
    const next = { orders: [], bookings: [], paintingRequests: [], potteryRequests: [] };
    const keys = ["orders", "bookings", "paintingRequests", "potteryRequests"];
    const responseKeys = ["orders", "bookings", "requests", "requests"];
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") next[keys[index]] = result.value[responseKeys[index]] || [];
      else errors.push(`${["Orders", "Mural requests", "Artwork requests", "Pottery requests"][index]}: ${result.reason.message}`);
    }
    setData(next);
    setError(errors.join(" "));
    setLoading(false);
  }, []);
  useEffect(() => { Promise.resolve().then(load); }, [load]);
  async function decide(kind, request, status) {
    setBusyId(request.id);
    setError("");
    try {
      if (kind === "painting") await api.updateAdminPaintingRequest(request.id, status);
      else await api.updateAdminWallBooking(request.id, status);
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusyId(""); }
  }
  async function update(fn) {
    try { await fn(); await load(); }
    catch (err) { setError(err.message); }
  }
  const potteryStatus = (status) => status === "requested" || status === "pending" ? "pending" : status;
  const visiblePotteryRequests = data.potteryRequests.filter((request) => potteryFilter === "all" || potteryStatus(request.status) === potteryFilter);
  const potteryEmptyMessage = potteryFilter === "pending" ? "No pending pottery requests." : `No ${potteryFilter === "all" ? "pottery" : potteryFilter + " pottery"} requests.`;
  const orderStatus = (order) => String(order.status || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const visibleOrders = data.orders.filter((order) => {
    const status = orderStatus(order);
    if (orderFilter === "all") return true;
    if (orderFilter === "pending") return status === "placed" || status === "pending_confirmation";
    if (orderFilter === "cancelled") return status === "cancelled";
    if (orderFilter === "confirmed") return status === "confirmed" || status === "processing";
    if (orderFilter === "shipped") return status === "shipped" || status === "in_transit";
    if (orderFilter === "delivered") return status === "delivered";
    return false;
  });
  const orderFilterLabels = {
    all: "All Orders",
    pending: "Placed",
    confirmed: "Pending",
    shipped: "Shipped / In Transit",
    delivered: "Delivered",
    cancelled: "Cancelled",
  };
  const orderEmptyMessages = {
    all: "No server checkout orders.",
    pending: "No pending orders.",
    confirmed: "No confirmed or processing orders.",
    shipped: "No shipped or in-transit orders.",
    delivered: "No delivered orders.",
    cancelled: "No cancelled orders.",
  };
  return <main className="container page">
    <p className="eyebrow">Private workspace</p><h1>Studio administration</h1>
    <SectionTabs tabs={accountSections} active={activeSection} onSelect={setActiveSection} label="Studio sections" idPrefix="studio"/>
    <Notice error={error}/>
    {loading && <p role="status">Loading studio records…</p>}
    <SectionPanel idPrefix="studio" section={accountSections[0]} active={activeSection === "artwork"}>
    <h2>Artwork requests</h2>
    <FilteredRequests rows={data.paintingRequests} kind="Artwork" busyId={busyId} onDecision={(request,status)=>decide("painting",request,status)}/>
    </SectionPanel>
    <SectionPanel idPrefix="studio" section={accountSections[1]} active={activeSection === "murals"}>
    <h2>Mural requests</h2>
    <FilteredRequests rows={data.bookings} kind="Mural" busyId={busyId} onDecision={(request,status)=>decide("mural",request,status)}/>
    </SectionPanel>
    <SectionPanel idPrefix="studio" section={accountSections[2]} active={activeSection === "pottery"}>
    <h2>Pottery requests</h2>
    <div className="request-filters" role="group" aria-label="Pottery request status filter">
      {["all", "pending", "accepted", "declined", "cancelled"].map((filter) => <button key={filter} type="button" className={`request-filter${potteryFilter === filter ? " request-filter--active" : ""}`} aria-pressed={potteryFilter === filter} onClick={() => setPotteryFilter(filter)}>{filter[0].toUpperCase() + filter.slice(1)}</button>)}
    </div>
    <RecordList rows={visiblePotteryRequests} empty={potteryEmptyMessage} render={(request)=><><b>{request.customer_email} · {request.quantity} × {request.item_name}</b><span>{request.glaze_name} · needed {String(request.needed_by).slice(0,10)} · {potteryStatus(request.status) === "pending" ? "Pending" : request.status}</span>{request.status === "requested" && <div className="actions"><button className="text-link" disabled={busyId === request.id} onClick={()=>update(()=>api.updateAdminPotteryRequest(request.id,"accepted"))}>Accept</button><button className="text-link" disabled={busyId === request.id} onClick={()=>update(()=>api.updateAdminPotteryRequest(request.id,"declined"))}>Decline</button></div>}</>}/>
    </SectionPanel>
    <SectionPanel idPrefix="studio" section={accountSections[3]} active={activeSection === "orders"}>
    <h2>Checkout orders</h2>
    <div className="request-filters" role="group" aria-label="Order status filter">
      {Object.entries(orderFilterLabels).map(([filter, label]) => <button key={filter} type="button" className={`request-filter${orderFilter === filter ? " request-filter--active" : ""}`} aria-pressed={orderFilter === filter} onClick={() => setOrderFilter(filter)}>{label}</button>)}
    </div>
    <RecordList rows={visibleOrders} empty={orderEmptyMessages[orderFilter]} render={(order)=><div className="order-history"><div className="order-history-head"><b>Order #{order.id} · {order.customer_email}</b><span>{order.status} · {order.payment_method === "cod" ? "COD" : "Legacy purchase"} · {money(order.total_amount)}</span></div><p>Placed {order.created_at ? new Date(order.created_at).toLocaleDateString("en-IN") : "Date unavailable"}</p><ul>{(order.items||[]).map((line,index)=><li key={line.id||index}>{line.name} × {line.quantity} — {money(line.line_total)} · {line.item_status||line.status}</li>)}</ul>{order.delivery_address&&<p className="address-summary"><b>Delivery:</b> {order.delivery_address.full_name}, {order.delivery_address.house}, {order.delivery_address.street}, {order.delivery_address.locality}, {order.delivery_address.city}, {order.delivery_address.state} {order.delivery_address.pin_code} · {order.delivery_address.phone}</p>}</div>}/>
    </SectionPanel>
  </main>;
}


export default App;
