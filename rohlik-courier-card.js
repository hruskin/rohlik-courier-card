/*
 * Rohlík.cz – delivery banner card.
 *
 * A slim full-width banner that changes with the order:
 *   - ordered, courier not yet on the way: the delivery window, Rohlík's
 *     latest message and the order summary;
 *   - courier on the way: the countdown, the trip progress (departure → live
 *     ETA, which keeps moving) and the reusable bags to hand back;
 *   - no order: hidden.
 * Installed through HACS (Dashboard), which also adds the Lovelace resource:
 *
 *   type: custom:rohlik-courier-card
 *
 * Needs the Rohlík.cz integration with courier tracking
 * (https://github.com/hruskin/HA-Rohlik-dynamic) for the courier states.
 *
 * Entities are found by the integration's translation keys; override with
 * `<name>_entity` (courier, eta, minutes, bags, ordered, info, since, till).
 */

const VERSION = "1.0.0";
const DOMAIN = "rohlikcz";
const KEYS = {
  courier: ["binary_sensor", "courier_on_the_way"],
  eta: ["sensor", "delivery_time"],
  minutes: ["sensor", "delivery_minutes"],
  bags: ["sensor", "bags_amount"],
  ordered: ["binary_sensor", "is_ordered"],
  info: ["sensor", "delivery_info"],
  since: ["sensor", "next_order_since"],
  till: ["sensor", "next_order_till"],
};
const NEARBY_MINUTES = 8;
const SHIFT_MINUTES = 5;
const TICK_MS = 30_000;

const STYLE = `
:host { display: block; container: rk / inline-size; }
:host([hidden]) { display: none; }

.banner {
  --rk-bg: var(--ha-card-background, var(--card-background-color, #fff));
  --rk-border: var(--ha-card-border-color, var(--divider-color, #e0e0e0));
  --rk-radius: var(--ha-card-border-radius, 12px);
  --rk-text: var(--primary-text-color, #212121);
  --rk-text-2: var(--secondary-text-color, #727272);
  --rk-accent: var(--primary-color, #03a9f4);
  --rk-warn: var(--warning-color, #ff9800);
  --rk-warn-text: color-mix(in srgb, var(--rk-warn) 74%, var(--rk-text));
  --rk-rail: color-mix(in srgb, var(--rk-text) 10%, transparent);
  --rk-state: var(--rk-accent);

  position: relative;
  box-sizing: border-box;
  min-height: 96px;
  padding: 14px 20px;
  display: grid;
  grid-template-columns: 48px 264px 1fr auto;
  grid-template-areas: "icon count track bags";
  align-items: center;
  column-gap: 20px;
  background: var(--rk-bg);
  border: var(--ha-card-border-width, 1px) solid var(--rk-border);
  border-radius: var(--rk-radius);
  box-shadow: var(--ha-card-box-shadow, none);
  color: var(--rk-text);
  font-family: var(--ha-font-family-body, Roboto, "Helvetica Neue", Arial, sans-serif);
  -webkit-font-smoothing: antialiased;
  cursor: pointer;
  outline: none;
}
.banner:focus-visible { box-shadow: 0 0 0 2px var(--rk-accent); }
ha-icon { display: block; }

.icon {
  grid-area: icon;
  width: 48px; height: 48px; border-radius: 50%;
  display: grid; place-items: center;
  color: var(--rk-state);
  background: color-mix(in srgb, var(--rk-state) 12%, transparent);
  --mdc-icon-size: 28px;
}

.count { grid-area: count; min-width: 0; }
.count__main { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
.count__num {
  font-size: 44px; line-height: 44px; font-weight: 400; letter-spacing: -.5px;
  font-variant-numeric: tabular-nums;
}
.count__unit { font-size: 20px; color: var(--rk-text-2); }
.count__sub {
  margin-top: 6px; font-size: 15px; line-height: 20px; color: var(--rk-text-2);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.count__sub b { font-weight: 500; color: var(--rk-text); }
.count__sub ha-icon { display: inline-block; --mdc-icon-size: 16px; vertical-align: -3px; margin-right: 3px; }
.dot::before { content: "·"; margin: 0 6px; }

.track { grid-area: track; min-width: 0; padding-top: 18px; }
.track__line { display: flex; align-items: center; gap: 10px; }
.track__rail { position: relative; flex: 1; height: 6px; border-radius: 3px; background: var(--rk-rail); }
.track__fill {
  position: absolute; inset: 0 auto 0 0; width: calc(var(--p) * 100%);
  border-radius: inherit; background: var(--rk-state);
  transition: width .8s ease;
}
.track__marker {
  position: absolute; top: 50%; left: calc(var(--p) * 100%);
  width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
  background: var(--rk-state); box-shadow: 0 0 0 3px var(--rk-bg);
  transition: left .8s ease;
}
.track__orig {
  position: absolute; top: -4px; bottom: -4px; left: calc(var(--o) * 100%);
  width: 2px; margin-left: -1px; border-radius: 1px; background: var(--rk-warn);
  display: none;
}
.banner--shifted:not(.banner--late) .track__orig { display: block; }
.track__home { color: var(--rk-text-2); --mdc-icon-size: 22px; }
.track__labels {
  display: flex; justify-content: space-between; align-items: baseline; margin: 7px 32px 0 0;
  font-size: 13px; line-height: 16px; color: var(--rk-text-2);
  font-variant-numeric: tabular-nums;
}
.track__eta { color: var(--rk-text); font-size: 15px; }
.track__eta b { font-weight: 500; }
.track__eta s { text-decoration-thickness: 1px; color: var(--rk-text-2); }
.shift { color: var(--rk-warn-text); font-weight: 500; font-size: 13px; position: relative; top: -6px; line-height: 0; margin-left: 1px; display: none; }
.banner--shifted .shift { display: inline; }

.info { grid-area: track; min-width: 0; display: none; }
.info__msg {
  font-size: 15px; line-height: 20px; color: var(--rk-text);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.info__meta { margin-top: 4px; font-size: 13px; line-height: 16px; color: var(--rk-text-2); font-variant-numeric: tabular-nums; }
.banner--ordered .info { display: block; }
.banner--ordered .track { display: none; }

.bags {
  grid-area: bags;
  align-self: stretch;
  box-sizing: border-box; width: 150px;
  display: grid; grid-template-columns: auto auto; column-gap: 8px;
  align-content: center; justify-content: center; justify-items: center;
  padding: 0 8px; margin: -4px -8px -4px 0;
  border-left: 1px solid var(--rk-border);
}
.bags__icon { color: var(--rk-text-2); align-self: center; --mdc-icon-size: 26px; }
.bags__num { font-size: 36px; line-height: 40px; font-variant-numeric: tabular-nums; }
.bags__cap { grid-column: 1 / -1; font-size: 13px; line-height: 16px; color: var(--rk-text-2); margin-top: 2px; white-space: nowrap; }

.preview-note {
  position: absolute; top: 6px; right: 12px;
  font-size: 11px; color: var(--rk-text-2); letter-spacing: .3px; text-transform: uppercase;
}

.banner--nearby .track__marker::after {
  content: ""; position: absolute; inset: -3px; border-radius: 50%;
  border: 2px solid var(--rk-state); opacity: 0;
  animation: rk-halo 2.4s ease-out infinite;
}
@keyframes rk-halo { 0% { transform: scale(1); opacity: .5; } 100% { transform: scale(2.4); opacity: 0; } }

.banner--arriving .count__num { font-size: 40px; letter-spacing: 0; }
.banner--arriving .bags {
  border-left-color: transparent;
  background: color-mix(in srgb, var(--rk-accent) 10%, transparent);
  border-radius: calc(var(--rk-radius) - 4px);
}
.banner--arriving .bags__icon { color: var(--rk-accent); }
.banner--arriving .bags__cap { color: var(--rk-text); }

.banner--late { --rk-state: var(--rk-warn); }
.banner--late .count__num { color: var(--rk-warn-text); }

@container rk (max-width: 760px) {
  .banner {
    grid-template-columns: 44px 1fr auto;
    grid-template-areas: "icon count bags" "track track track";
    row-gap: 6px; padding: 12px 16px 14px; column-gap: 14px;
  }
  .icon { width: 44px; height: 44px; }
  .track { padding-top: 4px; }
  .bags { align-self: center; width: auto; padding: 4px 12px; margin: 0 -4px 0 0; }
}
@container rk (max-width: 420px) {
  .count__num { font-size: 36px; line-height: 38px; }
  .icon { display: none; }
  .banner { grid-template-columns: 1fr auto; grid-template-areas: "count bags" "track track"; }
}

@media (prefers-reduced-motion: reduce) {
  .track__fill, .track__marker { transition: none; }
  .banner--nearby .track__marker::after { animation: none; opacity: .35; transform: scale(1.8); }
}
`;

const TEMPLATE = `
<div class="banner" role="button" tabindex="0">
  <div class="icon"><ha-icon icon="mdi:truck-fast-outline" aria-hidden="true"></ha-icon></div>
  <div class="count">
    <div class="count__main"><span class="count__num"></span><span class="count__unit">min</span></div>
    <div class="count__sub"></div>
  </div>
  <div class="track" role="progressbar" aria-label="Průběh jízdy kurýra" aria-valuemin="0" aria-valuemax="100">
    <div class="track__line">
      <div class="track__rail">
        <div class="track__fill"></div>
        <div class="track__orig"></div>
        <div class="track__marker"></div>
      </div>
      <div class="track__home"><ha-icon icon="mdi:home-outline" aria-hidden="true"></ha-icon></div>
    </div>
    <div class="track__labels"><span class="track__dep"></span><span class="track__eta"></span></div>
  </div>
  <div class="info"><div class="info__msg"></div><div class="info__meta"></div></div>
  <div class="bags">
    <div class="bags__icon"><ha-icon icon="mdi:shopping-outline" aria-hidden="true"></ha-icon></div>
    <div class="bags__num"></div>
    <div class="bags__cap"></div>
  </div>
</div>`;

const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const hm = (date) => date.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
const esc = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const toDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !isNaN(date) ? date : null;
};
const DAY = 86400000;
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
// "dnes" / "zítra" / "čt 23. 10."
const relativeDay = (date, now) => {
  const days = Math.round((startOfDay(date) - startOfDay(new Date(now))) / DAY);
  if (days === 0) return "dnes";
  if (days === 1) return "zítra";
  const weekday = date.toLocaleDateString("cs-CZ", { weekday: "short" });
  return `${weekday} ${date.getDate()}. ${date.getMonth() + 1}.`;
};
// "za 14 h 18 min" / "za 40 min"
const inDuration = (ms) => {
  const total = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(total / 60), m = total % 60;
  return h ? `za ${h} h${m ? ` ${m} min` : ""}` : `za ${m} min`;
};
const price = (amount) =>
  `${Number(amount).toLocaleString("cs-CZ", { maximumFractionDigits: 0 })} Kč`;
// "+420000000001" → "000 000 001"
const formatPhone = (phone) => {
  const digits = String(phone).replace(/\D/g, "").replace(/^420(?=\d{9}$)/, "");
  return digits.length === 9 ? digits.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3") : phone;
};

class RohlikCourierCard extends HTMLElement {
  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  set preview(value) {
    this._preview = value;
    this._render();
  }

  set editMode(value) {
    this._editMode = value;
    this._render();
  }

  getCardSize() {
    return 2;
  }

  getGridOptions() {
    return { columns: "full", rows: "auto", min_columns: 6 };
  }

  connectedCallback() {
    this._timer = setInterval(() => this._render(), TICK_MS);
    this._render();
  }

  disconnectedCallback() {
    clearInterval(this._timer);
  }

  _entityId(name) {
    const configured = this._config?.[`${name}_entity`];
    if (configured) return configured;
    const [domain, key] = KEYS[name];
    const entities = this._hass?.entities || {};
    const found = Object.values(entities).find(
      (e) => e.platform === DOMAIN && e.translation_key === key && e.entity_id.startsWith(`${domain}.`)
    );
    return found?.entity_id;
  }

  _state(name) {
    const id = this._entityId(name);
    return id ? this._hass?.states[id] : undefined;
  }

  _build() {
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${STYLE}</style>${TEMPLATE}`;
    const $ = (sel) => root.querySelector(sel);
    this._el = {
      banner: $(".banner"), icon: $(".icon ha-icon"), num: $(".count__num"), unit: $(".count__unit"),
      sub: $(".count__sub"), track: $(".track"), msg: $(".info__msg"), meta: $(".info__meta"), rail: $(".track__rail"), orig: $(".track__orig"),
      dep: $(".track__dep"), eta: $(".track__eta"), bagsNum: $(".bags__num"), bagsCap: $(".bags__cap"),
    };
    const open = () => {
      const entityId = this._entityId(this._mode === "ordered" ? "ordered" : "courier");
      if (!entityId) return;
      this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
    };
    this._el.banner.addEventListener("click", open);
    this._el.banner.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        open();
      }
    });
  }

  _data() {
    const courier = this._state("courier");
    if (courier?.state !== "on" && this._state("ordered")?.state === "on") return this._orderedData();
    if (courier?.state !== "on") {
      if (!(this._preview || this._editMode)) return null;
      // Dashboard editor: show what the banner looks like.
      const now = Date.now();
      return {
        mode: "trip", demo: true, now, dep: new Date(now - 43 * 60000), eta: new Date(now + 47 * 60000),
        eta0: new Date(now + 47 * 60000), mins: 47, courier: "Petr", phone: null, nearby: false, bags: 9,
      };
    }
    const a = courier.attributes;
    const now = Date.now();
    const eta = toDate(this._state("eta")?.state);
    const minutesState = Number.parseInt(this._state("minutes")?.state, 10);
    const mins = Number.isNaN(minutesState)
      ? eta && Math.floor((eta - now) / 60000)
      : minutesState;
    const bags = Number.parseInt(this._state("bags")?.state, 10);
    return {
      mode: "trip", now, eta, mins: mins ?? null,
      dep: toDate(a.departed_at),
      eta0: toDate(a.initial_eta) || eta,
      courier: a.courier, phone: a.phone, nearby: a.nearby,
      bags: Number.isNaN(bags) ? null : bags,
    };
  }

  _orderedData() {
    const order = this._state("ordered")?.attributes?.order_data || {};
    const slot = order.deliverySlot || {};
    const info = this._state("info")?.state;
    const bags = Number.parseInt(this._state("bags")?.state, 10);
    return {
      mode: "ordered", now: Date.now(),
      since: toDate(this._state("since")?.state) || toDate(slot.since),
      till: toDate(this._state("till")?.state) || toDate(slot.till),
      message: info && !["unknown", "unavailable"].includes(info) ? info : null,
      items: order.itemsCount ?? null,
      total: order.priceComposition?.total?.amount ?? null,
      bags: Number.isNaN(bags) ? null : bags,
    };
  }

  _renderOrdered(d) {
    const el = this._el;
    const started = d.since && d.now >= d.since;
    el.banner.className = "banner banner--ordered";
    el.icon.setAttribute("icon", "mdi:package-variant-closed");
    el.num.textContent = d.since ? hm(d.since) : "–";
    el.unit.hidden = !d.since;
    el.unit.textContent = d.since ? relativeDay(d.since, d.now) : "";
    const till = d.till ? hm(d.till) : null;
    el.sub.textContent = started
      ? `okno běží${till ? ` do ${till}` : ""} · kurýr ještě nevyjel`
      : [till ? `okno do ${till}` : null, d.since ? inDuration(d.since - d.now) : null].filter(Boolean).join(" · ");
    el.msg.textContent = d.message || "Objednávka čeká na doručení";
    el.meta.textContent = [
      d.items != null ? `${d.items} ${plural(d.items, "položka", "položky", "položek")}` : null,
      d.total != null ? price(d.total) : null,
    ].filter(Boolean).join(" · ");
    el.bagsNum.textContent = String(d.bags ?? "–");
    el.bagsCap.textContent = `${plural(d.bags ?? 0, "taška", "tašky", "tašek")} k vrácení`;
    el.banner.setAttribute("aria-label",
      `Rohlík: objednávka${d.since ? ` dorazí ${relativeDay(d.since, d.now)} od ${hm(d.since)}` : ""}${till ? ` do ${till}` : ""}.`);
  }

  _render() {
    if (!this._hass || !this._config) return;
    const d = this._data();
    this.hidden = d === null;
    if (d === null) return;
    if (!this._el) this._build();
    const el = this._el;
    this._mode = d.mode;
    this.shadowRoot.querySelector(".preview-note")?.remove();
    if (d.mode === "ordered") {
      this._renderOrdered(d);
      return;
    }

    const mins = d.mins;
    const state = mins === null ? "on-way"
      : mins < 0 ? "late"
      : mins <= 1 ? "arriving"
      : d.nearby || mins <= NEARBY_MINUTES ? "nearby"
      : "on-way";
    const shift = d.eta && d.eta0 ? Math.round((d.eta - d.eta0) / 60000) : 0;
    const shifted = shift >= SHIFT_MINUTES;

    el.banner.className = `banner banner--${state}${shifted ? " banner--shifted" : ""}`;
    el.icon.setAttribute("icon", state === "arriving" ? "mdi:map-marker-radius-outline" : "mdi:truck-fast-outline");

    const name = d.courier ? `<b>${esc(d.courier)}</b>` : "";
    const phone = d.phone && state !== "on-way"
      ? `<span class="dot"></span><ha-icon icon="mdi:phone" aria-hidden="true"></ha-icon><b>${esc(formatPhone(d.phone))}</b>`
      : "";
    let num, sub;
    switch (state) {
      case "late":
        num = `+${-mins}`;
        sub = `Zpoždění${name ? `<span class="dot"></span>${name}` : ""}${phone}`;
        break;
      case "arriving":
        num = "Přijíždí";
        sub = `Kurýr ${name}${phone}`;
        break;
      case "nearby":
        num = String(mins);
        sub = name ? `${name} je blízko${phone}` : `Kurýr je blízko${phone}`;
        break;
      default:
        num = mins === null ? "–" : String(mins);
        sub = name ? `Kurýr ${name} je na cestě` : "Kurýr je na cestě";
    }
    el.num.textContent = num;
    el.unit.textContent = "min";
    el.unit.hidden = state === "arriving";
    el.sub.innerHTML = sub;

    // Trip progress: departure → current ETA. The ETA moves, so the marker can slide back.
    const dep = d.dep && d.eta && d.dep < d.eta ? d.dep : d.eta ? new Date(Math.min(d.now, d.eta - 3600000)) : null;
    const span = dep && d.eta ? Math.max(60000, d.eta - dep) : null;
    const p = span ? Math.max(0, Math.min(1, (d.now - dep) / span)) : 0;
    const o = span && d.eta0 ? Math.max(0, Math.min(1, (d.eta0 - dep) / span)) : 0;
    el.rail.style.setProperty("--p", p.toFixed(3));
    el.rail.style.setProperty("--o", o.toFixed(3));
    el.track.setAttribute("aria-valuenow", String(Math.round(p * 100)));
    el.dep.textContent = dep ? `odjezd ${hm(dep)}` : "";
    el.orig.title = d.eta0 ? `původní odhad ${hm(d.eta0)}` : "";
    el.eta.innerHTML = !d.eta ? ""
      : state === "late" ? `měl být <s>${hm(d.eta)}</s>`
      : `příjezd <b>${hm(d.eta)}</b><span class="shift">+${shift}</span>`;

    const bags = d.bags ?? "–";
    el.bagsNum.textContent = String(bags);
    el.bagsCap.textContent = state === "arriving"
      ? "připravte k vrácení"
      : `${plural(d.bags ?? 0, "taška", "tašky", "tašek")} k vrácení`;

    const bagsText = d.bags === null ? "" : ` Vrátit ${d.bags} ${plural(d.bags, "tašku", "tašky", "tašek")}.`;
    el.banner.setAttribute("aria-label",
      state === "late" ? `Rohlík: kurýr má zpoždění ${-mins} minut.${bagsText}`
      : state === "arriving" ? `Rohlík: kurýr přijíždí.${bagsText}`
      : `Rohlík: kurýr dorazí za ${mins ?? "?"} minut${d.eta ? `, v ${hm(d.eta)}` : ""}.${bagsText}`);

    if (d.demo) {
      const note = document.createElement("div");
      note.className = "preview-note";
      note.textContent = "Náhled · zobrazí se při objednávce";
      el.banner.append(note);
    }
  }
}

if (!customElements.get("rohlik-courier-card")) {
  console.info(`%c ROHLIK-COURIER-CARD %c ${VERSION} `, "color:#fff;background:#03a9f4", "");
  customElements.define("rohlik-courier-card", RohlikCourierCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "rohlik-courier-card",
    name: "Rohlík – doručení",
    description: "Pruh s objednávkou a odpočtem příjezdu kurýra; zobrazí se jen při objednávce.",
    documentationURL: "https://github.com/hruskin/rohlik-courier-card",
  });
}
