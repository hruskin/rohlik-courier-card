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
 * `<name>_entity` (courier, eta, minutes, bags, ordered, info, since, till, deadline).
 */

const VERSION = "1.0.3";
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
  deadline: ["sensor", "order_edit_deadline"],
};
// Rohlík.cz brand icon from the Home Assistant brands repository (what HA itself shows).
const LOGO_URL = "https://brands.home-assistant.io/rohlikcz/icon.png";
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
  --rk-num-weight: 400;

  position: relative;
  box-sizing: border-box;
  min-height: 72px;
  padding: 12px 20px;
  display: grid;
  grid-template-columns: 48px 232px 1fr auto;
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
.icon__logo { display: none; width: 40px; height: 40px; object-fit: contain; }
.icon--logo { background: none; }
.icon--logo .icon__logo { display: block; }
.icon--logo ha-icon { display: none !important; }

.count { grid-area: count; min-width: 0; }
.count__main { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
.count__num {
  font-size: 44px; line-height: 44px; font-weight: var(--rk-num-weight); letter-spacing: -.5px;
  font-variant-numeric: tabular-nums;
}
.count__unit { font-size: 20px; color: var(--rk-text-2); }
.count__sub {
  margin-top: 6px; font-size: 15px; line-height: 20px; color: var(--rk-text-2);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.count__sub:empty { display: none; }

.track { grid-area: track; min-width: 0; }
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
.track__home { color: var(--rk-text-2); --mdc-icon-size: 20px; }
.track__labels {
  display: flex; justify-content: space-between; align-items: baseline; margin: 2px 32px 0 0;
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
  display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;
}
.info__msg b { font-weight: 500; }
.info__msg span { color: var(--rk-text-2); }
.banner--ordered .info { display: block; }
.banner--ordered .track { display: none; }

.bags {
  grid-area: bags;
  align-self: stretch;
  box-sizing: border-box; min-width: 150px;
  display: grid; grid-template-columns: auto auto auto; column-gap: 8px;
  align-items: center; align-content: center; justify-content: center;
  padding: 0 10px 0 18px; margin: -4px -8px -4px 0;
  border-left: 1px solid var(--rk-border);
}
.bags__icon { color: var(--rk-text-2); --mdc-icon-size: 24px; }
.bags__num { font-size: 36px; line-height: 40px; font-weight: var(--rk-num-weight); font-variant-numeric: tabular-nums; }
.bags__cap { font-size: 13px; line-height: 16px; color: var(--rk-text-2); white-space: pre-line; }

/* order items: a native modal dialog, so it escapes the card's containment */
.items {
  box-sizing: border-box; width: min(480px, calc(100vw - 32px)); max-height: min(80vh, 640px);
  padding: 0; border: none; border-radius: var(--ha-card-border-radius, 12px);
  background: var(--card-background-color, #fff); color: var(--primary-text-color, #212121);
  font-family: var(--ha-font-family-body, Roboto, "Helvetica Neue", Arial, sans-serif);
  box-shadow: 0 8px 32px rgba(0, 0, 0, .25);
}
.items[open] { display: flex; flex-direction: column; }
.items::backdrop { background: rgba(0, 0, 0, .4); }
.items__head {
  display: flex; align-items: center; gap: 12px; padding: 16px 12px 12px 20px;
  border-bottom: 1px solid var(--divider-color, #e0e0e0);
}
.items__title { flex: 1; font-size: 18px; font-weight: 500; }
.items__close {
  width: 36px; height: 36px; border: none; border-radius: 50%; background: none; cursor: pointer;
  color: var(--secondary-text-color, #727272); font-size: 24px; line-height: 36px;
}
.items__close:hover { background: color-mix(in srgb, var(--primary-text-color, #212121) 8%, transparent); }
.items__list { list-style: none; margin: 0; padding: 4px 0 12px; overflow-y: auto; outline: none; }
.items__list li {
  display: flex; justify-content: space-between; gap: 16px; padding: 10px 20px;
  font-size: 15px; line-height: 20px;
}
.items__list li + li { border-top: 1px solid color-mix(in srgb, var(--divider-color, #e0e0e0) 60%, transparent); }
.items__qty { flex: none; color: var(--secondary-text-color, #727272); font-variant-numeric: tabular-nums; }

/* sits on the top border like a fieldset legend, clear of the content */
.preview-note {
  position: absolute; top: 0; left: 50%; transform: translate(-50%, -50%);
  padding: 0 8px; background: var(--rk-bg); white-space: nowrap;
  font-size: 11px; line-height: 14px; color: var(--rk-text-2); letter-spacing: .3px; text-transform: uppercase;
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
  .track { padding-top: 0; }
  .bags { align-self: center; min-width: 0; padding: 4px 12px; margin: 0 -4px 0 0; }
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
  <div class="icon"><img class="icon__logo" alt="" aria-hidden="true"><ha-icon icon="mdi:truck-fast-outline" aria-hidden="true"></ha-icon></div>
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
  <div class="info"><div class="info__msg"></div></div>
  <div class="bags">
    <div class="bags__icon"><ha-icon icon="mdi:shopping-outline" aria-hidden="true"></ha-icon></div>
    <div class="bags__num"></div>
    <div class="bags__cap"></div>
  </div>
</div>
<dialog class="items" aria-label="Položky nákupu">
  <div class="items__head"><span class="items__title"></span><button class="items__close" aria-label="Zavřít">×</button></div>
  <ul class="items__list" tabindex="-1"></ul>
</dialog>
`;

const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const hm = (date) => date.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
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

class RohlikCourierCard extends HTMLElement {
  static getStubConfig() {
    return {};
  }

  static async getConfigElement() {
    await loadEditorComponents();
    return document.createElement("rohlik-courier-card-editor");
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
      sub: $(".count__sub"), track: $(".track"), msg: $(".info__msg"), rail: $(".track__rail"), orig: $(".track__orig"),
      dep: $(".track__dep"), eta: $(".track__eta"), bagsNum: $(".bags__num"), bagsCap: $(".bags__cap"),
      iconTile: $(".icon"), logo: $(".icon__logo"),
    };
    // Without the brands CDN (offline tablet) fall back to the state icon.
    this._el.logo.addEventListener("error", () => {
      this._logoFailed = true;
      this._el.iconTile.classList.remove("icon--logo");
    });
    const dialog = root.querySelector(".items");
    root.querySelector(".items__close").addEventListener("click", () => dialog.close());
    // A click on the backdrop lands on the dialog element itself.
    dialog.addEventListener("click", (ev) => ev.target === dialog && dialog.close());
    const open = () => {
      if (this._openItems(dialog)) return;
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

  // The order's line items in a modal; false when the integration has none to show.
  _openItems(dialog) {
    const items = this._state("ordered")?.attributes?.items;
    if (!Array.isArray(items) || !items.length) return false;
    dialog.querySelector(".items__title").textContent =
      `Nákup · ${items.length} ${plural(items.length, "položka", "položky", "položek")}`;
    const list = dialog.querySelector(".items__list");
    list.replaceChildren(...items.map((item) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = item.name ?? "";
      const qty = document.createElement("span");
      qty.className = "items__qty";
      const amount = Number(item.amount) || 1;
      const textual = item.textual_amount || "";
      const perPiece = textual.match(/^1\s+(\S+)$/); // "1 ks" × 4 → "4 ks"
      qty.textContent = amount <= 1 ? textual || "1 ks"
        : perPiece ? `${amount} ${perPiece[1]}`
        : `${amount} ×${textual ? ` ${textual}` : ""}`;
      li.append(name, qty);
      return li;
    }));
    dialog.showModal();
    list.focus(); // not the close button, which would show a focus ring
    list.scrollTop = 0;
    return true;
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
        eta0: new Date(now + 47 * 60000), mins: 47, nearby: false, bags: 9,
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
      nearby: a.nearby,
      bags: Number.isNaN(bags) ? null : bags,
    };
  }

  _orderedData() {
    const order = this._state("ordered")?.attributes?.order_data || {};
    const slot = order.deliverySlot || {};
    const bags = Number.parseInt(this._state("bags")?.state, 10);
    return {
      mode: "ordered", now: Date.now(),
      since: toDate(this._state("since")?.state) || toDate(slot.since),
      till: toDate(this._state("till")?.state) || toDate(slot.till),
      deadline: toDate(this._state("deadline")?.state),
      bags: Number.isNaN(bags) ? null : bags,
    };
  }

  _renderOrdered(d) {
    const el = this._el;
    el.banner.className = "banner banner--ordered";
    el.icon.setAttribute("icon", "mdi:package-variant-closed");
    el.num.textContent = d.since ? hm(d.since) : "–";
    el.unit.hidden = !d.since;
    el.unit.textContent = d.since ? relativeDay(d.since, d.now) : "";
    const till = d.till ? hm(d.till) : null;
    el.sub.textContent = "";
    // Only until when items can still be added; nothing once that has passed.
    const canAdd = d.deadline && d.deadline > d.now;
    el.msg.innerHTML = canAdd
      ? `<span>Doobjednat do</span> <b>${relativeDay(d.deadline, d.now)} ${hm(d.deadline)}</b>`
      : "";
    el.bagsNum.textContent = String(d.bags ?? "–");
    el.bagsCap.textContent = `${plural(d.bags ?? 0, "taška", "tašky", "tašek")}\nk vrácení`;
    el.banner.setAttribute("aria-label",
      `Rohlík: objednávka${d.since ? ` dorazí ${relativeDay(d.since, d.now)} od ${hm(d.since)}` : ""}${till ? ` do ${till}` : ""}.`
      + (canAdd ? ` Doobjednat lze do ${relativeDay(d.deadline, d.now)} ${hm(d.deadline)}.` : ""));
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
    const logo = this._config.show_logo !== false && !this._logoFailed;
    if (logo && !el.logo.getAttribute("src")) el.logo.src = LOGO_URL;
    el.iconTile.classList.toggle("icon--logo", logo);
    el.banner.style.setProperty("--rk-num-weight", this._config.number_weight === "bold" ? "600" : "400");
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

    el.num.textContent = state === "late" ? `+${-mins}`
      : state === "arriving" ? "Přijíždí"
      : mins === null ? "–" : String(mins);
    el.unit.textContent = "min";
    el.unit.hidden = state === "arriving";
    el.sub.textContent = "";

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
      ? "připravte\nk vrácení"
      : `${plural(d.bags ?? 0, "taška", "tašky", "tašek")}\nk vrácení`;

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

// Make sure ha-form and the entity picker are loaded before the editor renders:
// building the stock entities card's editor pulls them in.
const loadEditorComponents = async () => {
  if (customElements.get("ha-form") && customElements.get("ha-entity-picker")) return;
  const helpers = await window.loadCardHelpers?.();
  const card = await helpers?.createCardElement({ type: "entities", entities: [] });
  await card?.constructor?.getConfigElement?.();
};

const ENTITY_FIELDS = [
  ["courier_entity", "Kurýr na cestě", "binary_sensor"],
  ["eta_entity", "Čas doručení", "sensor"],
  ["minutes_entity", "Minuty do doručení", "sensor"],
  ["bags_entity", "Počet tašek", "sensor"],
  ["ordered_entity", "Další objednávka", "binary_sensor"],
  ["info_entity", "Informace o doručení", "sensor"],
  ["since_entity", "Začátek doručení", "sensor"],
  ["till_entity", "Konec doručení", "sensor"],
  ["deadline_entity", "Doobjednat do", "sensor"],
];
const EDITOR_SCHEMA = [
  { name: "show_logo", selector: { boolean: {} } },
  {
    name: "number_weight",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "regular", label: "Normální" },
          { value: "bold", label: "Tučné" },
        ],
      },
    },
  },
  {
    name: "entities",
    type: "expandable",
    flatten: true,
    title: "Entity (jen při více účtech Rohlík.cz)",
    schema: ENTITY_FIELDS.map(([name, , domain]) => ({
      name,
      selector: { entity: { filter: { integration: DOMAIN, domain } } },
    })),
  },
];
const EDITOR_LABELS = {
  show_logo: "Logo Rohlíku vlevo",
  number_weight: "Písmo čísel",
  ...Object.fromEntries(ENTITY_FIELDS.map(([name, label]) => [name, label])),
};

class RohlikCourierCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      const note = document.createElement("p");
      note.style.cssText = "margin:0 0 12px;color:var(--secondary-text-color);font-size:14px";
      note.textContent =
        "Karta si entity integrace Rohlík.cz najde sama. Vyber je jen tehdy, když máš víc účtů.";
      this._form = document.createElement("ha-form");
      this._form.schema = EDITOR_SCHEMA;
      this._form.computeLabel = (schema) => EDITOR_LABELS[schema.name] ?? schema.title ?? schema.name;
      this._form.addEventListener("value-changed", (ev) => {
        const config = { ...ev.detail.value };
        for (const [key, value] of Object.entries(config)) {
          if (value === "" || value === undefined || value === null) delete config[key];
        }
        // Keep defaults out of the YAML.
        if (config.show_logo === true) delete config.show_logo;
        if (config.number_weight === "regular") delete config.number_weight;
        this._config = config;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
      });
      this.append(note, this._form);
    }
    this._form.hass = this._hass;
    this._form.data = { show_logo: true, number_weight: "regular", ...this._config };
  }
}

if (!customElements.get("rohlik-courier-card-editor")) {
  customElements.define("rohlik-courier-card-editor", RohlikCourierCardEditor);
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
