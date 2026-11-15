// Client-side app: listings page and listing detail, with client-side navigation.
const view = document.getElementById("view");
const money = (n) => n.toLocaleString("en-US", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const api = (p) => fetch(p).then((r) => { if (r.status === 401) location.assign("/login"); return r.json(); });

document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link]");
  if (!a) return;
  e.preventDefault();
  history.pushState(null, "", a.getAttribute("href"));
  route();
});
addEventListener("popstate", route);

async function listingsPage() {
  view.innerHTML = '<h1>Listings</h1><p class="muted">Loading listings…</p>';
  const items = await api("/api/listings");
  view.innerHTML = `<h1>Listings</h1><div class="grid">${items.map((l) => `
    <a class="listing" data-link href="/app/listing/${l.id}">
      <div class="photo"></div>
      <div>${l.address}</div>
      <div class="muted">${l.kind} · ${l.rooms} rooms · ${l.area} m²</div>
      <div class="price">${money(l.price)}</div>
    </a>`).join("")}</div>`;
}

// Price distribution of comparable sales, built from a simulated sample.
function summarize(listing) {
  const sample = [];
  let seed = listing.price % 9973;
  for (let i = 0; i < SAMPLE_SIZE; i++) { seed = (seed * 16807) % 2147483647; sample.push(listing.price * (0.7 + (seed / 2147483647) * 0.6)); }
  sample.sort((a, b) => a - b);
  const bins = new Array(24).fill(0);
  const lo = sample[0], hi = sample[sample.length - 1];
  for (const v of sample) bins[Math.min(23, Math.floor(((v - lo) / (hi - lo)) * 24))]++;
  return { median: sample[sample.length >> 1], bins };
}
const SAMPLE_SIZE = 110000;

async function detailPage(id) {
  view.innerHTML = '<p class="muted">Loading listing…</p>';
  const l = await api(`/api/listings/${id}`);
  if (l.error) { view.innerHTML = '<h1>Listing not found</h1><p><a href="/app" data-link>Back to listings</a></p>'; return; }
  const total = l.costs.reduce((s, [, v]) => s + v, 0);
  view.innerHTML = `
    <p><a href="/app" data-link>← Listings</a></p>
    <div class="detail-head"><div><h1>${l.address}</h1><div class="muted">${l.kind} · ${l.rooms} rooms · ${l.area} m²</div></div>
      <button id="show-details">Show details</button></div>
    <section class="details" id="details" hidden></section>
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected="true" data-tab="overview">Overview</button>
      <button role="tab" aria-selected="false" data-tab="costs">Costs</button>
    </div>
    <div id="tab"></div>`;
  const tabs = {
    overview: `<table class="figures"><tr><th>Asking price</th><th>Price per m²</th><th>Total cost to own</th><th>Status</th></tr>
      <tr><td>${money(l.price)}</td><td>${money(l.price / l.area)}</td><td>${money(total)}</td><td>Open for bids</td></tr></table>`,
    costs: `<ul class="costs">${l.costs.map(([k, v]) => `<li><span>${k}</span><span>${money(v)}</span></li>`).join("")}
      <li><span>Total</span><span>${money(total)}</span></li></ul>`,
  };
  const show = (name) => {
    for (const b of view.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
    document.getElementById("tab").innerHTML = `<div class="tab-body">${tabs[name]}</div>`;
  };
  view.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
  show("overview");
  document.getElementById("show-details").addEventListener("click", (e) => {
    const d = document.getElementById("details");
    if (!d.hidden) { d.hidden = true; e.target.textContent = "Show details"; return; }
    d.hidden = false;
    d.innerHTML = '<strong>Comparable sales</strong><div class="muted">Calculating…</div><div class="bars"></div>';
    d.classList.remove("entering"); void d.offsetWidth; d.classList.add("entering");
    e.target.textContent = "Hide details";
    setTimeout(() => {
      const s = summarize(l);
      const max = Math.max(...s.bins);
      d.innerHTML = `<strong>Comparable sales</strong><div class="muted">Median ${money(s.median)}</div>
        <div class="bars">${s.bins.map((n) => `<span style="height:${(n / max) * 100}%"></span>`).join("")}</div>`;
    }, 0);
  });
}

async function loadNotice() {
  const n = await api("/api/notice");
  if (n.text) document.getElementById("notice-slot").innerHTML = `<div class="notice">${n.text}</div>`;
}

function route() {
  const m = location.pathname.match(/^\/app\/listing\/([^/]+)/);
  return m ? detailPage(m[1]) : listingsPage();
}
route();
loadNotice();
